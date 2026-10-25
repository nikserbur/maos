"""Наборы сценариев внешних условий (CRN) для SimEnv — METHODOLOGY-V2 §2, §7.2, §10.2а.

Сценарий i = недельный макро-путь обученного генератора (rl/macro: ключевая ставка, курс,
инфляция, режим HMM) + дефолт покупателя (поток [seed, 911]) + множители стресса. Потоки
фиксированы: один и тот же индекс i даёт один и тот же путь для всех сравниваемых политик.
Розыгрыши длительностей/поломок — внутри SimEnv по seed = seed_base + i (по идентичности джобы).

Блок контрагентского риска (CPR, rl.cp.enabled [К], по умолчанию выкл. — результаты A1–A4 не меняются):
при cp_enabled события покупателей и поставщиков берутся из генератора C++ (maos_env.cp_events, поток
[seed, 915, idx, kind, entity]) — розыгрыш не дублируется на Python; legacy-дефолт [seed, 911] тогда не
применяется (без двойного счёта). Шок A2 supply_delay остаётся отдельным видом. Переключение в кризис A2
(сплайс пути с недели w) переводит и режимы событий контрагентов в кризис с месяца ⌊12w/52⌋; стресс «joint»
(force_default) — дефолт крупнейшего покупателя в неделю legacy-розыгрыша (0-based). Общий фактор F_i
генератором Python не публикуется — f_tilde = NaN (загрузка λ_F не применяется).
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
CP_WEEKS_MIN = 52           # CPR: недель розыгрыша событий (префикс по неделям — горизонт SimEnv не влияет на события)
SHOCK_STREAM = 913          # A2: поток экстренных событий (шоков) — свой, CRN по индексу сценария
# A2: параметры шоков [К] rl.shock.* — доли нижней оценки Cmax экземпляра (SimEnv разрешает на reset).
# Генератор событий (база): вероятности по видам [отказ узкого места, срочный заказ, срыв поставки,
# переключение в кризис] — реальный цех живёт с ними, статические планы их не видят [К] rl.shock.p_base.
EVENTS_BASE = (0.2, 0.3, 0.2, 0.0)
EVENTS_SHOCK = (0.5, 0.5, 0.5, 0.5)
SHOCK = {"outage_at": (0.1, 0.5), "outage_dur": (0.08, 0.25), "rush_at": (0.1, 0.5),
         "rush_qty": (0.3, 1.0), "rush_due": (1.5, 3.0), "supply_delay": (0.05, 0.2), "regime_week": (2, 10)}


@dataclass(frozen=True)
class StressSpec:
    """Меню §10.2а п.5: regime — режим навязан; quantile — Student-t квантильный стресс;
    lead_mul/default — совместный шок (задержки поставок ×2 + дефолт крупнейшего покупателя)."""
    name: str = "base"
    macro: dict | None = None
    lead_mul: float = 1.0
    force_default: bool = False
    price_mul: float = 1.0
    events: tuple = EVENTS_BASE  # A2: вероятности событий по видам (отказ, срочный заказ, поставка, кризис)
    at_least_one: bool = False   # A2: стресс «шок» — в каждом сценарии ≥ 1 событие


STRESSES: dict[str, StressSpec] = {
    "base": StressSpec(),
    "crisis": StressSpec("crisis", macro={"regime": -2}),       # заполняется кризисным режимом при создании
    "quantile": StressSpec("quantile", macro={"quantile_t": 0.99}),
    "joint": StressSpec("joint", lead_mul=2.0, force_default=True),
    # A2: «шок» — в каждом сценарии ≥ 1 экстренное событие: отказ станка узкого места, срочный заказ с
    # жёстким сроком, срыв поставки критичного входа, переключение в кризисный макро-режим.
    "shock": StressSpec("shock", events=EVENTS_SHOCK, at_least_one=True),
    "calm": StressSpec("calm", events=(0.0, 0.0, 0.0, 0.0)),     # без событий (как генератор A1)
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
    cp_enabled: bool = False          # rl.cp.enabled [К]: события контрагентов из C++ (по умолчанию выкл.)
    cp_params: dict | None = None     # fin.cp.* (None → умолчания паспорта, enabled включается флагом)
    cp_suppliers: tuple = ()          # покупные позиции НСИ экземпляра (поставщики; entity = FNV-1a кода)
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
        if self.cp_enabled:                                    # CPR: сырые режимы и блоки по месяцам для C++
            self._paths["regime_m"] = np.asarray(r["regime"]).astype(int)
            self._paths["block_m"] = np.asarray(r["block_id"]).astype(int)
            self._paths["crisis"] = crisis_regime(params)      # режим событий после переключения A2
        self._shocks = self._draw_shocks(sampler, params) if any(p > 0 for p in self.stress.events) else [None] * self.n

    def _draw_shocks(self, sampler, params) -> list[dict | None]:
        """Экстренные события по индексу сценария (поток [seed, 913]); переключение режима — сплайс
        кризисного макро-пути (тот же seed, режим навязан) с недели w."""
        rng = np.random.default_rng([self.seed, SHOCK_STREAM])
        crisis = sampler.sample(self.n, self.seed, self.weeks, stress={"regime": crisis_regime(params)}) if self.stress.events[3] > 0 else None
        cw = crisis["weekly"] if crisis else None
        p = np.asarray(self.stress.events, float)
        out: list[dict | None] = []
        for i in range(self.n):
            kinds = rng.random(4) < p
            pick = int(rng.integers(0, 4))
            if self.stress.at_least_one and not kinds.any():
                kinds[pick] = True
            u = rng.random(9)
            if not kinds.any():
                out.append(None)
                continue
            lo_hi = lambda k, x: float(SHOCK[k][0] + (SHOCK[k][1] - SHOCK[k][0]) * x)  # noqa: E731
            sh: dict = {}
            if kinds[0]:
                sh.update(outage_at=lo_hi("outage_at", u[0]), outage_dur=lo_hi("outage_dur", u[1]))
            if kinds[1]:
                sh.update(rush_at=lo_hi("rush_at", u[2]), rush_qty=lo_hi("rush_qty", u[3]), rush_due=lo_hi("rush_due", u[4]),
                          rush_order=int(u[5] * 1000))
            if kinds[2]:
                sh.update(supply_delay=lo_hi("supply_delay", u[6]))
            if kinds[3] and cw is not None:
                w = int(SHOCK["regime_week"][0] + (SHOCK["regime_week"][1] - SHOCK["regime_week"][0]) * u[7])
                sh["regime_shock_week"] = w
                sh["_splice"] = {"key": (np.asarray(cw["key"], float)[i] / 100.0).tolist(), "fx": np.asarray(cw["fx"], float)[i].tolist(),
                                 "cpi": np.asarray(cw["cpi"], float)[i].tolist(), "regime": crisis_regime(params)}
            out.append(sh)
        return out

    @property
    def regime_share(self) -> dict[int, float]:
        return self._paths["regime_share"]

    def scenario(self, i: int, with_shock: bool = True) -> dict:
        p = self._paths
        default = bool(p["u"][i] < self.pd) or self.stress.force_default
        out = {
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
        if self.cp_enabled:                                    # CPR: события из C++, legacy-дефолт не применяется
            out["default_week"], out["lgd"] = -1, 0.0
        sh = self._shocks[i] if with_shock else None
        if sh:
            out.update({k: v for k, v in sh.items() if not k.startswith("_")})
            if "_splice" in sh:                       # кризис с недели w: ставка/курс/инфляция/режим — кризисный путь
                w, sp = sh["regime_shock_week"], sh["_splice"]
                for k in ("key_rate", "fx", "cpi"):
                    src = sp["key" if k == "key_rate" else k]
                    out[k] = out[k][:w] + [float(x) for x in src[w:]]
                out["regime"] = out["regime"][:w] + [int(sp["regime"])] * (len(out["regime"]) - w)
        if self.cp_enabled:                                    # кризис A2 — и у событий контрагентов с недели w
            out["cp"] = self.cp_events(i, sh["regime_shock_week"] if sh and "_splice" in sh else None)
            if self.stress.force_default:                      # «joint»: дефолт крупнейшего покупателя
                force_buyer_default(out["cp"], self._largest_buyer(), int(p["dweek"][i]) - 1)
        return out

    def _largest_buyer(self) -> int:
        """Покупатель с наибольшей долей: явные buyer_shares → argmax, иначе Зипф — покупатель 0."""
        shares = (self.cp_params or {}).get("buyer_shares") or []
        return int(np.argmax(shares)) if len(shares) else 0

    def cp_events(self, i: int, crisis_from_week: int | None = None) -> dict:
        """События контрагентов сценария i ({"events", "params"}) — maos_env.cp_events (генератор C++).
        crisis_from_week — неделя переключения в кризис A2: месяцы ≥ ⌊12w/52⌋ получают кризисный режим."""
        from rl.env.core import load_module
        params = {**(self.cp_params or {}), "enabled": True}
        p = self._paths
        regime = [int(x) for x in p["regime_m"][i]]
        if crisis_from_week is not None:
            m0 = int(math.floor(12.0 * crisis_from_week / 52.0))
            regime = regime[:m0] + [int(p["crisis"])] * (len(regime) - m0)
        return json.loads(load_module().cp_events(
            json.dumps(params), int(self.seed), int(i), regime, [int(x) for x in p["block_m"][i]],
            max(CP_WEEKS_MIN, int(self.weeks)), list(self.cp_suppliers), float("nan"), str(self.params_path)))

    def scenario_json(self, i: int) -> str:
        return json.dumps(self.scenario(i))

    def has_shock(self, i: int) -> bool:
        return self._shocks[i] is not None

    def twin_json(self, i: int) -> str:
        """Тот же сценарий БЕЗ экстренных событий (CRN-пара для потерь, приписываемых шоку)."""
        return json.dumps(self.scenario(i, with_shock=False))

    def regime_of(self, i: int) -> int:
        """Преобладающий режим сценария (для обоснования хода)."""
        vals, cnt = np.unique(self._paths["regime"][i], return_counts=True)
        return int(vals[int(np.argmax(cnt))])


def force_buyer_default(cp: dict, buyer: int, week: int) -> None:
    """Стресс «joint» в CPR: дефолт покупателя buyer не позже недели week (0-based); событие раньше — сохраняется."""
    b = cp["events"]["buyers"][buyer]
    cur = int(b["default_week"])
    b["default_week"] = week if cur < 0 else min(cur, week)


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
