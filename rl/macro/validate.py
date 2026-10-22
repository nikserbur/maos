"""V1: покрытие и CRPS обученного генератора на отложенных целях (METHODOLOGY-V2 §10.1 V1, §8).

Ретроспективный rolling-origin: для каждой цели с 2023-01 по последний месяц модель
(VAR/SVD/HMM с выбранными R, b; тренд курса) переоценивается ТОЛЬКО по прошлому до origin = target − h,
h = 12 месяцев; 2048 путей; метрики в натуральных единицах (π г/г %, ставка %, курс руб./долл.):
CRPS, покрытие 80 % и 90 % полос, PIT; базы — персистентность и 4 % (инфляция).
Пересмотренная история, не реальные винтажи; перекрывающиеся ошибки зависимы (без i.i.d. ДИ).
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import learning as le
from .anchored import observations

HOLDOUT_FROM = "2023-01"
HORIZON = 12
SIMS = 2048


def to_levels(z, trend, t_index):
    """z (n×3, исходные единицы признаков) → (π %, i %, S руб.) для месяца t_index."""
    pi = 100 * np.expm1(z[..., 0] / 100)
    key = z[..., 1] + pi + 2
    fx = np.exp((z[..., 2] + trend[0] + trend[1] * t_index) / 100)
    return pi, key, fx


def holdout(f: pd.DataFrame, regimes: int, block: int, horizon: int = HORIZON, sims: int = SIMS,
            start: str = HOLDOUT_FROM, seed_base: int = 2026101800):
    idx = pd.PeriodIndex(f.month, freq="M")
    rows = []
    for end in np.flatnonzero(idx >= pd.Period(start)):
        origin = end - horizon
        if origin < 24:
            continue
        past = f.iloc[:origin + 1]
        a, trend = observations(past)
        m = le.model(a, regimes)
        s, _, _ = le.simulate(m, sims, horizon, seed_base + int(end), block)
        pi_s, key_s, fx_s = to_levels(s[:, -1, :], trend, end)
        actual = f.iloc[end]
        truth = {"cpi_yoy_pp": float(actual.cpi_yoy_pp), "key_pp": float(actual.key_end_pp), "usd_rub": float(actual.usd_rub_end)}
        last = f.iloc[origin]
        persist = {"cpi_yoy_pp": float(last.cpi_yoy_pp), "key_pp": float(last.key_end_pp), "usd_rub": float(last.usd_rub_end)}
        row = {"origin": str(idx[origin]), "target": str(idx[end]), "horizon_months": horizon}
        for name, smp in (("cpi_yoy_pp", pi_s), ("key_pp", key_s), ("usd_rub", fx_s)):
            y = truth[name]
            q10, q90, q05, q95 = np.quantile(smp, [.1, .9, .05, .95])
            row[name] = {"actual": y, "mean": float(smp.mean()), "q10": float(q10), "q90": float(q90),
                         "q05": float(q05), "q95": float(q95),
                         "covered80": bool(q10 <= y <= q90), "covered90": bool(q05 <= y <= q95),
                         "PIT": float((smp < y).mean()), "CRPS": le.crps(smp, y),
                         "CRPS_persistence": abs(persist[name] - y)}
            if name == "cpi_yoy_pp":
                row[name]["CRPS_fixed4"] = abs(4.0 - y)
        rows.append(row)
    return rows


def summarize(rows):
    out = {"n": len(rows), "horizon_months": HORIZON, "start_target": HOLDOUT_FROM, "variables": {}}
    for name in ("cpi_yoy_pp", "key_pp", "usd_rub"):
        v = [r[name] for r in rows]
        s = {"coverage80": float(np.mean([x["covered80"] for x in v])),
             "coverage90": float(np.mean([x["covered90"] for x in v])),
             "mean_CRPS": float(np.mean([x["CRPS"] for x in v])),
             "mean_CRPS_persistence": float(np.mean([x["CRPS_persistence"] for x in v])),
             "rmse_mean": float(np.sqrt(np.mean([(x["mean"] - x["actual"]) ** 2 for x in v]))),
             "rmse_persistence": float(np.sqrt(np.mean([(x["CRPS_persistence"]) ** 2 for x in v]))),
             "PIT_histogram10": np.histogram([x["PIT"] for x in v], bins=np.linspace(0, 1, 11))[0].tolist()}
        if name == "cpi_yoy_pp":
            s["mean_CRPS_fixed4"] = float(np.mean([x["CRPS_fixed4"] for x in v]))
        out["variables"][name] = s
    threshold = 0.6
    out["flags"] = {"threshold": threshold,
                    "undercoverage80": [k for k, v in out["variables"].items() if v["coverage80"] < threshold],
                    "note": "недопокрытие раскрывается, не скрывается: полосы генератора условны на конечный "
                            "эмпирический носитель (§13); для таких переменных — квантильный стресс"}
    out["caveat"] = ("ретроспектива по пересмотренной истории; перекрывающиеся 12-месячные ошибки зависимы; "
                     "номинальное покрытие 80/90 % — не гарантия проспективного покрытия")
    return out
