"""Структурный режим A3 (L2/L3 вокруг узкого места): прогон политик и Gymnasium-обёртка для PPO.

Эпоха решения — начало недели и экстренное событие (отказ, срочный заказ, вскрывшийся срыв поставки);
между эпохами L0 диспетчеризует в C++ (`run_l0`) статическим чемпионом экземпляра (правило/ключ) или режимом,
выбранным ходом dispatch_*. Наблюдение — 48 признаков (SimEnvStruct.cpp: узкое место, прогноз просрочки с
учётом мощности, касса/лимит, макро-режим, статусы инвестиций), действия — 13 ходов с масками.

Награда для обучения (терминальная, CRN): (Π − Π_ref)/V + w_c·(C_min − C_min,ref)/V на ТОМ ЖЕ сценарии, где
ref — эталонная политика (BC-учитель); хвостовые для эталона сценарии (Π_ref ≤ α-квантиль) весят (1 + κ) —
CVaR-фокус (Tamar et al. 2015, перевзвешивание худших эпизодов пакета CRN).
"""
from __future__ import annotations

import json
from typing import Any, Callable, Sequence

import gymnasium as gym
import numpy as np

from .core import load_module, make_config
from .scenarios import ScenarioSet

N_OBS, N_ACT = 48, 13
ACTS = ["noop", "overtime", "outsource_op", "alt_route", "split", "invest0", "invest1", "invest2",
        "draw", "repay", "dispatch_default", "dispatch_edd", "dispatch_expedite"]
A = {n: i for i, n in enumerate(ACTS)}
STRUCT_CFG = {"l2_enabled": True, "struct_mode": True, "dense_reward": False, "max_moves_per_week": 3}

# Признаки наблюдения (индексы — SimEnv::build_obs_struct).
F = {"week": 0, "t": 1, "rho_rem": 2, "rho2": 3, "queue_bn": 4, "ot_active": 5, "ot_used": 6, "outage": 7, "shock_seen": 8,
     "rush_rem": 9, "rush_slack": 10, "supply_late": 11, "tard": 12, "late_share": 13, "late_value": 14, "min_slack": 15,
     "fin_share": 16, "done_share": 17, "cash": 18, "undrawn": 19, "debt": 20, "breach": 21, "min_cash": 22, "key": 23,
     "reg0": 24, "reg1": 25, "reg2": 26, "fx": 27, "inv0": 28, "inv1": 29, "inv2": 30, "capex_ratio0": 34,
     "disp0": 39, "disp1": 40, "disp2": 41, "moves": 42, "shock_epoch": 43, "rho_all": 44, "weeks_left": 45}

StructPolicy = Callable[[np.ndarray, np.ndarray], np.ndarray]   # (obs[B,48], mask[B,13]) → действия[B]
N_OBS_AUG = N_OBS + N_ACT     # наблюдение RL: 48 признаков + one-hot хода учителя H* (поправка П3)


def augment(obs: np.ndarray, mask: np.ndarray, teacher: StructPolicy | None) -> np.ndarray:
    """Наблюдение RL = признаки SimEnv + one-hot хода, который предложила бы неучащаяся политика H* экземпляра
    (вычислима онлайн по тому же наблюдению). Учитель различен по экземплярам (пороги, покупки), поэтому без этого
    контекста BC не может воспроизвести учителя (поправка П3 предрегистрации); RL учится, КОГДА отклоняться."""
    obs = np.atleast_2d(obs).astype(np.float32); mask = np.atleast_2d(mask).astype(bool)
    a = np.zeros(len(obs), dtype=int) if teacher is None else np.asarray(teacher(obs, mask), dtype=int)
    oh = np.zeros((len(obs), N_ACT), dtype=np.float32)
    oh[np.arange(len(obs)), a] = 1.0
    return np.concatenate([obs, oh], axis=1)


def rl_policy(model, teacher: StructPolicy | None) -> StructPolicy:
    """Детерминированная политика RL поверх учителя экземпляра: argmax маскированных логитов на (obs, ход H*)."""
    def f(obs: np.ndarray, mask: np.ndarray) -> np.ndarray:
        a, _ = model.predict(augment(obs, mask, teacher), action_masks=mask, deterministic=True)
        return np.asarray(a)
    return f


def make_struct_env(instance, cfg: dict | None = None, dispatch: tuple[str, list[float]] | None = None):
    me = load_module()
    env = me.SimEnv(instance, make_config({**STRUCT_CFG, **(cfg or {})}))
    if dispatch:
        env.set_dispatch(dispatch[0], list(dispatch[1] or []))
    return env


def run_struct(instance, policy: StructPolicy | None, scenarios: ScenarioSet, idxs: Sequence[int], seed_base: int,
               cfg: dict | None = None, dispatch: tuple[str, list[float]] | None = None,
               static_invest: Sequence[tuple[int, int]] = (), twin: bool = False, record: bool = False) -> list[dict]:
    """Прогон набора сценариев (CRN по индексу) структурной политикой; батч по всем средам на каждой эпохе.
    policy = None → noop (только диспетчеризация чемпионом). static_invest — (кандидат, неделя) до эпизода.
    record → в итог добавляются (obs, mask, action) каждой эпохи (для BC)."""
    envs = []
    for i in idxs:
        e = make_struct_env(instance, cfg, dispatch)
        for c, w in static_invest:
            e.schedule_invest(int(c), int(w))
        e.reset(seed_base + i, scenarios.twin_json(i) if twin else scenarios.scenario_json(i))
        envs.append(e)
    traj: list[list] = [[] for _ in envs]
    active = list(range(len(envs)))
    while active:
        for k in active:
            if envs[k].level == 0 and not envs[k].done:
                envs[k].run_l0()
        l2 = [k for k in active if envs[k].level == 2 and not envs[k].done]
        if l2:
            obs = np.stack([envs[k].obs_l2() for k in l2]).astype(np.float32)
            mask = np.stack([envs[k].mask_l2() for k in l2]).astype(bool)
            acts = np.zeros(len(l2), dtype=int) if policy is None else np.asarray(policy(obs, mask), dtype=int)
            for k, o, m, a in zip(l2, obs, mask, acts):
                if record:
                    traj[k].append((o, m, int(a)))
                envs[k].step(int(a) if m[int(a)] else 0)
        active = [k for k in active if not envs[k].done]
    out = []
    for k, e in enumerate(envs):
        s = json.loads(e.summary())
        if record:
            s["_traj"] = traj[k]
        out.append(s)
    return out


class StructEnv(gym.Env):
    """Gymnasium: шаг = один структурный ход на эпохе L3 (noop завершает эпоху; L0 — в C++ до следующей)."""

    metadata = {"render_modes": []}

    def __init__(self, instances: Sequence[Any], scenarios: ScenarioSet, seed_base: int, dispatch: Sequence[tuple],
                 ref: Sequence[dict] | None = None, cfg: dict | None = None, kappa: float = 4.0, alpha: float = 0.1,
                 w_cash: float = 0.5, seed: int = 0, static_invest: Sequence[Sequence[tuple[int, int]]] | None = None,
                 teachers: Sequence[StructPolicy | None] | None = None):
        super().__init__()
        self.envs = [make_struct_env(inst, cfg, d) for inst, d in zip(instances, dispatch)]
        for e, si in zip(self.envs, static_invest or [()] * len(self.envs)):
            for c, w in si:
                e.schedule_invest(int(c), int(w))
        self.scen, self.seed_base, self.ref = scenarios, seed_base, ref
        self.kappa, self.alpha, self.w_cash = kappa, alpha, w_cash
        self.value = [max(1.0, sum(o["price"] * o["qty"] for o in json.loads(e.instance_to_json())["orders"])) for e in self.envs]
        # α-квантиль прибыли эталона по экземпляру (по пулу обучающих сценариев) — граница CVaR-хвоста.
        self.eta = [float(np.quantile(r["profit"], alpha)) if r else 0.0 for r in (ref or [None] * len(self.envs))]
        self.rng = np.random.default_rng(seed)
        self.teachers = list(teachers) if teachers is not None else None
        self.observation_space = gym.spaces.Box(-np.inf, np.inf, (N_OBS_AUG if teachers is not None else N_OBS,), dtype=np.float32)
        self.action_space = gym.spaces.Discrete(N_ACT)
        self.k, self.i = 0, 0
        self.cur = self.envs[0]

    def reset(self, *, seed: int | None = None, options: dict | None = None):
        if seed is not None:
            self.rng = np.random.default_rng(seed)
        options = options or {}
        self.k = options.get("instance", int(self.rng.integers(len(self.envs))))
        self.i = options.get("scenario", int(self.rng.integers(self.scen.n)))
        self.cur = self.envs[self.k]
        self.cur.reset(self.seed_base + self.i, self.scen.scenario_json(self.i))
        self._advance()
        return self._obs(), {"instance": self.k, "scenario": self.i}

    def _advance(self) -> None:
        while not self.cur.done and self.cur.level == 0:
            self.cur.run_l0()

    def step(self, action: int):
        m = self.cur.mask_l2()
        a = int(action) if m[int(action)] else 0
        self.cur.step(a)
        self._advance()
        reward, info = 0.0, {}
        if self.cur.done:
            s = json.loads(self.cur.summary())
            info["summary"] = s
            reward = self.terminal_reward(s)
        return self._obs(), float(reward), bool(self.cur.done), False, info

    def terminal_reward(self, s: dict) -> float:
        v = self.value[self.k]
        if self.ref is None:
            return s["profit"] / v
        r = self.ref[self.k]
        p0, c0 = r["profit"][self.i], r["min_cash"][self.i]
        w = 1.0 + (self.kappa if p0 <= self.eta[self.k] + 1e-9 else 0.0)
        return float(100.0 * (w * (s["profit"] - p0) + self.w_cash * (min(0.0, s["min_cash"]) - min(0.0, c0))) / v)

    def action_masks(self) -> np.ndarray:
        if self.cur.done:
            m = np.zeros(N_ACT, dtype=bool); m[0] = True
            return m
        return self.cur.mask_l2().astype(bool)

    def _obs(self) -> np.ndarray:
        n = self.observation_space.shape[0]
        if self.cur.done:
            return np.zeros(n, dtype=np.float32)
        o = self.cur.obs_l2().astype(np.float32)
        if self.teachers is None:
            return o
        return augment(o, self.cur.mask_l2(), self.teachers[self.k])[0]
