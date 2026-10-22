"""Наборы сценариев внешних условий (CRN) для SimEnv — METHODOLOGY-V2 §2, §7.2, §10.2а.

Сценарий i = недельный макро-путь обученного генератора (rl/macro: ключевая ставка, курс,
инфляция, режим HMM) + дефолт покупателя (поток [seed, 911]) + множители стресса. Потоки
фиксированы: один и тот же индекс i даёт один и тот же путь для всех сравниваемых политик.
Розыгрыши длительностей/поломок — внутри SimEnv по seed = seed_base + i (по идентичности джобы).
"""
from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from rl.macro.sample import PARAMS_PATH, Sampler, load_params

HOLDOUT_SEED = 2026102201   # [НОРМ] §10.2а п.1
DEFAULT_STREAM = 911        # поток дефолтов (§11.3а: payments)


@dataclass(frozen=True)
class StressSpec:
    """Меню §10.2а п.5: regime — режим навязан; quantile — Student-t квантильный стресс;
    lead_mul/default — совместный шок (задержки поставок ×2 + дефолт крупнейшего покупателя)."""
    name: str = "base"
    macro: dict | None = None
    lead_mul: float = 1.0
    force_default: bool = False
    price_mul: float = 1.0


STRESSES: dict[str, StressSpec] = {
    "base": StressSpec(),
    "crisis": StressSpec("crisis", macro={"regime": -2}),       # заполняется кризисным режимом при создании
    "quantile": StressSpec("quantile", macro={"quantile_t": 0.99}),
    "joint": StressSpec("joint", lead_mul=2.0, force_default=True),
}


@dataclass
class ScenarioSet:
    n: int
    seed: int
    weeks: int = 26
    stress: StressSpec = field(default_factory=StressSpec)
    pd: float = 0.02      # fin.pd [К]
    lgd: float = 0.45     # fin.lgd [НОРМ]
    params_path: Path = PARAMS_PATH
    _paths: dict = field(default_factory=dict, init=False, repr=False)

    def __post_init__(self) -> None:
        params = load_params(self.params_path)
        sampler = Sampler(params)
        macro = dict(self.stress.macro or {})
        if macro.get("regime") == -2:          # «кризис» = режим с максимальной волатильностью ставки
            macro["regime"] = crisis_regime(params)
        r = sampler.sample(self.n, self.seed, self.weeks, stress=macro or None)
        wk = r["weekly"]
        key = np.asarray(wk["key"], dtype=float) / 100.0      # п.п. → доля
        fx = np.asarray(wk["fx"], dtype=float)
        cpi = np.asarray(wk["cpi"], dtype=float)
        reg = np.asarray(r["regime"])                          # [n][months]
        months = r["months"]
        wk_month = [min(months - 1, int(math.floor(w * 12.0 / 52.0))) for w in range(self.weeks)]
        regime_w = reg[:, wk_month] if reg.ndim == 2 else np.zeros((self.n, self.weeks), dtype=int)
        rng = np.random.default_rng([self.seed, DEFAULT_STREAM])
        u = rng.random(self.n)
        dweek = rng.integers(1, self.weeks + 1, size=self.n)
        self._paths = {"key": key, "fx": fx, "cpi": cpi, "regime": regime_w, "u": u, "dweek": dweek,
                       "regime_share": regime_share(regime_w)}

    @property
    def regime_share(self) -> dict[int, float]:
        return self._paths["regime_share"]

    def scenario(self, i: int) -> dict:
        p = self._paths
        default = bool(p["u"][i] < self.pd) or self.stress.force_default
        return {
            "idx": int(i),
            "key_rate": [float(x) for x in p["key"][i]],
            "fx": [float(x) for x in p["fx"][i]],
            "cpi": [float(x) for x in p["cpi"][i]],
            "regime": [int(x) for x in p["regime"][i]],
            "default_week": int(p["dweek"][i]) if default else -1,
            "lgd": self.lgd if default else 0.0,
            "lead_mul": self.stress.lead_mul,
            "price_mul": self.stress.price_mul,
        }

    def scenario_json(self, i: int) -> str:
        return json.dumps(self.scenario(i))

    def regime_of(self, i: int) -> int:
        """Преобладающий режим сценария (для обоснования хода)."""
        vals, cnt = np.unique(self._paths["regime"][i], return_counts=True)
        return int(vals[int(np.argmax(cnt))])


def crisis_regime(params: dict) -> int:
    """Режим HMM с наибольшей дисперсией остатка ставки — «кризис» (§2.6б)."""
    hmm = params.get("hmm", {})
    labels = list(hmm.get("labels", []))
    resid = np.asarray(params.get("resid", []), dtype=float)
    k = int(hmm.get("k", 1))
    if k <= 1 or resid.size == 0 or len(labels) != len(resid):
        return 0
    best, bv = 0, -1.0
    for h in range(k):
        sel = resid[np.asarray(labels) == h]
        if len(sel) < 2:
            continue
        v = float(np.var(sel[:, 1]) + np.var(sel[:, 2]))
        if v > bv:
            bv, best = v, h
    return best


def regime_share(regime_w: np.ndarray) -> dict[int, float]:
    vals, cnt = np.unique(regime_w, return_counts=True)
    tot = float(cnt.sum()) or 1.0
    return {int(v): float(c) / tot for v, c in zip(vals, cnt)}
