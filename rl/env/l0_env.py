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
