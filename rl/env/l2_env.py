"""Gymnasium-обёртка L2 (планировщик: структурные + финансовые ходы) поверх ЗАМОРОЖЕННОЙ политики L0.

Эпоха L2 — начало недели (и неделя 0). Между эпохами L2 среда прогоняется внутренней политикой L0:
правило (`rule:EDD`) или callable(obs, mask) → слот действия (обученная политика / ONNX).
Награда шага L2 = накопленная награда среды между решениями L2 (плотные дельты L0 + терминальная).
"""
from __future__ import annotations

import json
from typing import Any, Callable, Sequence

import gymnasium as gym
import numpy as np

from .core import load_module, make_config
from .scenarios import ScenarioSet

L0Policy = Callable[[np.ndarray, np.ndarray], int]


class L2Env(gym.Env):
    metadata = {"render_modes": []}

    def __init__(self, instances: Sequence[Any], cfg: dict[str, Any] | None = None,
                 scenarios: ScenarioSet | None = None, seed_base: int = 0,
                 l0_policy: str | L0Policy = "rule:EDD"):
        super().__init__()
        self.me = load_module()
        merged = {**(cfg or {}), "l2_enabled": True}
        self.cfg = make_config(merged)
        self.envs = [self.me.SimEnv(inst, self.cfg) for inst in instances]
        self.scenarios = scenarios
        self.seed_base = seed_base
        self.rng = np.random.default_rng(seed_base)
        self.l0_policy = l0_policy
        self.cur = self.envs[0]
        self.cur_idx = 0
        self.scenario_idx = -1
        self.observation_space = gym.spaces.Box(-np.inf, np.inf, (self.cur.obs_l2_size,), dtype=np.float32)
        self.action_space = gym.spaces.Discrete(self.cur.act_l2_size)

    def reset(self, *, seed: int | None = None, options: dict | None = None):
        if seed is not None:
            self.rng = np.random.default_rng(seed)
        options = options or {}
        self.cur_idx = options.get("instance", int(self.rng.integers(len(self.envs))))
        self.cur = self.envs[self.cur_idx]
        sc_json = ""
        if self.scenarios is not None:
            self.scenario_idx = options.get("scenario", int(self.rng.integers(self.scenarios.n)))
            sc_json = self.scenarios.scenario_json(self.scenario_idx)
        else:
            self.scenario_idx = options.get("scenario", int(self.rng.integers(1 << 30)))
        self.cur.reset(self.seed_base + self.scenario_idx, sc_json)
        self._run_l0()
        return self._obs(), {"instance": self.cur_idx, "scenario": self.scenario_idx}

    def step(self, action: int):
        r, done, level = self.cur.step(int(action))
        r += self._run_l0()
        info: dict[str, Any] = {}
        if self.cur.done:
            done = True
            info["summary"] = json.loads(self.cur.summary())
        return self._obs(), float(r), bool(done), False, info

    def action_masks(self) -> np.ndarray:
        return self.cur.mask_l2().astype(bool)

    def _l0_action(self) -> int:
        if isinstance(self.l0_policy, str):
            if self.l0_policy.startswith("rule:"):
                return self.cur.rule_slot(self.l0_policy[5:])
            raise ValueError(self.l0_policy)
        return int(self.l0_policy(self.cur.obs_l0(), self.cur.mask_l0()))

    def _run_l0(self) -> float:
        acc = 0.0
        while not self.cur.done and self.cur.level == 0:
            a = self._l0_action()
            if isinstance(self.l0_policy, str) and a >= self.cur.act_l0_size - 1:
                # правило выбрало кандидата вне слотов — шаг по индексу джобы
                r, _, _ = self.cur.step_job(self.cur.rule_choice(self.l0_policy[5:]))
            else:
                r, _, _ = self.cur.step(a)
            acc += r
        return acc

    def _obs(self) -> np.ndarray:
        if self.cur.done:
            return np.zeros(self.cur.obs_l2_size, dtype=np.float32)
        return self.cur.obs_l2().astype(np.float32)

    def summary(self) -> dict:
        return json.loads(self.cur.summary())
