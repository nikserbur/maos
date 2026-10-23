"""Gymnasium-обёртка L0 (диспетчер типа РЦ) с масками действий — MaskablePPO (sb3-contrib).

Одна политика на все типы РЦ (mean-field: наблюдение содержит пул соседей по типу); эпизод =
один сценарий на одном экземпляре; экземпляры и сценарии выбираются по seed (куррикулум —
список экземпляров). Эпохи L2 (если включены) проходятся «noop».
"""
from __future__ import annotations

import json
from typing import Any, Callable, Sequence

import gymnasium as gym
import numpy as np

from .core import load_module, make_config
from .scenarios import ScenarioSet


class L0Env(gym.Env):
    metadata = {"render_modes": []}

    def __init__(self, instances: Sequence[Any], cfg: dict[str, Any] | None = None,
                 scenarios: ScenarioSet | None = None, seed_base: int = 0,
                 instance_sampler: Callable[[np.random.Generator], int] | None = None):
        super().__init__()
        self.me = load_module()
        self.cfg = make_config(cfg)
        self.envs = [self.me.SimEnv(inst, self.cfg) for inst in instances]
        self.scenarios = scenarios
        self.seed_base = seed_base
        self.instance_sampler = instance_sampler
        self.rng = np.random.default_rng(seed_base)
        self.cur = self.envs[0]
        self.cur_idx = 0
        self.scenario_idx = -1
        self.observation_space = gym.spaces.Box(-np.inf, np.inf, (self.cur.obs_l0_size,), dtype=np.float32)
        self.action_space = gym.spaces.Discrete(self.cur.act_l0_size)
        self.episode = 0

    # ── Gymnasium ───────────────────────────────────────────────────────────
    def reset(self, *, seed: int | None = None, options: dict | None = None):
        if seed is not None:
            self.rng = np.random.default_rng(seed)
        options = options or {}
        self.cur_idx = options.get("instance", self.instance_sampler(self.rng) if self.instance_sampler
                                   else int(self.rng.integers(len(self.envs))))
        self.cur = self.envs[self.cur_idx]
        sc_json = ""
        if self.scenarios is not None:
            self.scenario_idx = options.get("scenario", int(self.rng.integers(self.scenarios.n)))
            sc_json = self.scenarios.scenario_json(self.scenario_idx)
            ep_seed = self.seed_base + self.scenario_idx
        else:
            self.scenario_idx = options.get("scenario", int(self.rng.integers(1 << 30)))
            ep_seed = self.seed_base + self.scenario_idx
        self.cur.reset(ep_seed, sc_json)
        self._ep = (self.cur_idx, ep_seed, sc_json)
        self._skip_l2()
        self.episode += 1
        return self._obs(), {"instance": self.cur_idx, "scenario": self.scenario_idx}

    def step(self, action: int):
        r, done, level = self.cur.step(int(action))
        r += self._skip_l2()
        info: dict[str, Any] = {}
        if self.cur.done:
            done = True
            info["summary"] = json.loads(self.cur.summary())
        return self._obs(), float(r), bool(done), False, info

    def action_masks(self) -> np.ndarray:
        return self.cur.mask_l0().astype(bool)

    # ── служебное ──────────────────────────────────────────────────────────
    def _skip_l2(self) -> float:
        acc = 0.0
        while not self.cur.done and self.cur.level == 2:
            r, _, _ = self.cur.step(0)
            acc += r
        return acc

    def _obs(self) -> np.ndarray:
        if self.cur.done:
            return np.zeros(self.cur.obs_l0_size, dtype=np.float32)
        return self.cur.obs_l0().astype(np.float32)

    def rule_action(self, rule: str) -> int:
        return self.cur.rule_slot(rule)

    def summary(self) -> dict:
        return json.loads(self.cur.summary())


RULES = ("EDD", "SPT", "LPT", "CR", "MWKR", "MS", "FIFO")   # индекс действия L0-rule → правило
A_CPSAT, A_DEFAULT = len(RULES), len(RULES) + 1              # 7 — очередь по ключу CP-SAT, 8 — статический чемпион экземпляра
A_EXPEDITE = len(RULES) + 2                                  # 9 — «ускорить срочный»: срочный заказ первым, иначе чемпион
N_ACTIONS = len(RULES) + 3


def resolve_action(a: int, default: int, has_cp: bool) -> int:
    """Действие политики → 0..7 (правило или CP-SAT) или 9 (ускорить срочный поверх чемпиона)."""
    a = int(a)
    if a == A_DEFAULT:
        a = int(default)
    if a == A_CPSAT and not has_cp:
        a = 0
    return a


def dispatch(env, a: int, cp_key: list[float] | None, default: int = 0) -> int:
    """Джоба, которую ставит действие a из маскированной очереди: 0..6 — правило, 7 — ключ CP-SAT,
    9 — срочный заказ первым, иначе статический чемпион default."""
    if a == A_EXPEDITE:
        d = A_CPSAT if (default == A_CPSAT and cp_key is not None) else (default if default < A_CPSAT else 0)
        return env.expedite_choice("" if d == A_CPSAT else RULES[d], cp_key if d == A_CPSAT else [])
    return env.key_choice(cp_key) if a == A_CPSAT and cp_key is not None else env.rule_choice(RULES[a])


class L0RuleEnv(L0Env):
    """L0 как ВЫБОР ПРАВИЛА (Tang 2026, A2): на той же эпохе решения (станок освободился) политика
    выбирает одно из 7 диспетч-правил, очередь по ключу CP-SAT (статический план солвера) или
    «статического чемпиона» экземпляра (лучшее из 8 на валидации) — и оно ставит операцию из
    маскированной очереди кандидатов (те же маски). WAIT не выбирается (non-delay). Политика «всегда
    чемпион» совпадает с ним побитово (CRN), поэтому инициализация клонированием поведения начинается
    ровно с чемпиона, а PPO учит, КОГДА отклоняться (экстренные события видны в obs_l0, A2).

    cvar=(α, λ): терминальная доля прибыли X = Π/V заменяется на (1−λ)X + λ·(η − (X−η)⁻/α) —
    вспомогательная переменная Рокафеллара–Урясева η = α-квантиль X последних эпизодов экземпляра."""

    rule_select = True

    def __init__(self, *args, defaults: list[int] | None = None, cp_keys: list | None = None,
                 cvar: tuple[float, float] | None = None, delta_h: float = 0.0, paired: float = 0.0, **kwargs):
        super().__init__(*args, **kwargs)
        # paired = κ > 0: терминальная награда — РАЗНОСТЬ прибыли с чемпионом на ТОМ ЖЕ сценарии (CRN-базовая
        # линия: экзогенная дисперсия вычитается), хвостовые сценарии чемпиона (≤ η) весят (1 + κ) — CVaR-фокус.
        self.paired = float(paired)
        self._twin = [self.me.SimEnv(self.me.Instance.from_json(e.instance_to_json()), self.cfg) for e in self.envs] if paired > 0 else []
        self._c_hist: list[list[float]] = [[] for _ in self.envs]
        self.delta_min = float(delta_h) * 60.0        # >0 → действие держится Δ часов модельного времени (макро-шаг)
        n = len(self.envs)
        self.defaults = list(defaults) if defaults is not None else [0] * n
        self.cp_keys = list(cp_keys) if cp_keys is not None else [None] * n
        self.cvar = cvar
        self._x_hist: list[list[float]] = [[] for _ in range(n)]
        self._value = [max(1.0, sum(o["price"] * o["qty"] for o in json.loads(e.instance_to_json())["orders"])) for e in self.envs]
        self.action_space = gym.spaces.Discrete(N_ACTIONS)

    def step(self, action: int):
        a = resolve_action(action, self.defaults[self.cur_idx], self.cp_keys[self.cur_idx] is not None)
        t_end = self.cur.now + self.delta_min
        r = 0.0
        while True:
            job = dispatch(self.cur, a, self.cp_keys[self.cur_idx], self.defaults[self.cur_idx])
            r1, done, level = self.cur.step_job(int(job))
            r += r1 + self._skip_l2()
            if self.cur.done or self.delta_min <= 0 or self.cur.now >= t_end:
                break
        info: dict[str, Any] = {"rule_action": a}
        if self.cur.done:
            done = True
            info["summary"] = json.loads(self.cur.summary())
            r += self._paired_reward(info["summary"]["profit"]) if self.paired > 0 else self._ru_shaping(info["summary"]["profit"])
        return self._obs(), float(r), bool(done), False, info

    def _ru_shaping(self, profit: float) -> float:
        if not self.cvar:
            return 0.0
        alpha, lam = self.cvar
        x = profit / self._value[self.cur_idx]
        hist = self._x_hist[self.cur_idx]
        hist.append(x)
        del hist[:-200]
        eta = float(np.quantile(hist, alpha)) if len(hist) >= 10 else x
        ru = eta - max(0.0, eta - x) / alpha
        return float(self.cur_cfg_wprofit() * lam * (ru - x))

    def _champion_profit(self) -> float:
        k, seed, sc = self._ep
        e = self._twin[k]
        e.reset(seed, sc)
        while not e.done:
            if e.level == 2:
                e.step(0)
                continue
            e.step_job(dispatch(e, resolve_action(A_DEFAULT, self.defaults[k], self.cp_keys[k] is not None),
                                self.cp_keys[k], self.defaults[k]))
        return json.loads(e.summary())["profit"]

    def _paired_reward(self, profit: float) -> float:
        k = self.cur_idx
        pc = self._champion_profit()
        v = self._value[k]
        hist = self._c_hist[k]
        hist.append(pc / v)
        del hist[:-200]
        alpha = self.cvar[0] if self.cvar else 0.1
        eta = float(np.quantile(hist, alpha)) if len(hist) >= 10 else pc / v
        w = 1.0 + (self.paired if pc / v <= eta + 1e-12 else 0.0)
        # Терминальная доля прибыли эпизода (w_profit·Π/V) заменяется парной разностью.
        return float(self.cur_cfg_wprofit() * (w * (profit - pc) / v * 100.0 - profit / v))

    def cur_cfg_wprofit(self) -> float:
        return float(self.cfg.w_profit)

    def action_masks(self) -> np.ndarray:
        m = np.ones(N_ACTIONS, dtype=bool)
        m[A_CPSAT] = self.cp_keys[self.cur_idx] is not None
        return m
