"""Признаки z_m, выбор (режимы, блок) по CRPS и экспорт параметров генератора
(METHODOLOGY-V2 §2.2, §2.6а; порт `research/revision/anchored.py` RJMF — Бураков 2026; RJMF 2026).

Признаки: z_m = [100 ln(1+π_m/100), i_m − π_m − 2, 100 ln S_m − (a + b m)].
Вторая компонента — прокси реальной ключевой ставки; третья — отклонение лог-курса от
линейного тренда, оценённого МНК на обучающем отрезке (не наблюдаемый реальный курс и не
доказательство стационарности — сценарное ограничение).

Выбор (R, b) ∈ {1,2,3}×{1,2,4,8} — по совместному стандартизованному CRPS на 24 перекрывающихся
целях 2021-01…2022-12 (горизонт 13 месяцев) при обучении до 2019-12; затем переоценка на всей истории.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from scipy import stats

from . import learning as le

TRAIN_END = "2019-12"
VALID_FROM, VALID_TO = "2020-01", "2022-12"
SELECTION_H = 13                      # как RJMF anchored.train: origin = end − 13
SELECTION_SIMS = 384
REGIME_GRID, BLOCK_GRID = (1, 2, 3), (1, 2, 4, 8)
STRESS_QUANTILES = (0.01, 0.05, 0.10, 0.25, 0.50, 0.75, 0.90, 0.95, 0.99)


def observations(f: pd.DataFrame, trend=None):
    """z_m из месячного ряда; тренд курса (a, b) — МНК на переданном отрезке либо заданный."""
    t = np.arange(len(f))
    s = 100 * np.log(f.usd_rub_end.to_numpy())
    if trend is None:
        trend = np.linalg.lstsq(np.c_[np.ones(len(t)), t], s, rcond=None)[0]
    a = np.c_[100 * np.log1p(f.cpi_yoy_pp.to_numpy() / 100),
              f.key_end_pp.to_numpy() - f.cpi_yoy_pp.to_numpy() - 2,
              s - np.c_[np.ones(len(t)), t] @ trend]
    return a, np.asarray(trend)


def standardized_crps_targets(f: pd.DataFrame, m, all_a, last, block, idx, seed_base=20261017):
    """CRPS на отложенных целях для одной модели/блока (RJMF: 384 путей, seed 20261017+end)."""
    values = []
    for end in np.flatnonzero((idx >= pd.Period(VALID_FROM)) & (idx <= pd.Period(VALID_TO))):
        origin = end - SELECTION_H
        if origin < last:
            continue
        mm = dict(m)
        mm["last"] = (all_a[origin] - m["mean"]) / m["sd"]
        z = (all_a[:origin + 1] - m["mean"]) / m["sd"]
        r = z[1:] - z[:-1] @ m["A"]
        h = dict(m["hmm"])
        h["filtered"] = le.hmm_filter(h, r @ m["svd_vectors"][:m["rank"]].T)
        mm["hmm"] = h
        s, _, _ = le.simulate(mm, SELECTION_SIMS, SELECTION_H, seed_base + end, block)
        per_var = [le.crps(s[:, -1, j] / m["sd"][j], all_a[end, j] / m["sd"][j]) for j in range(3)]
        # Наивные базы на тех же целях: персистентность (точечный прогноз → CRPS = |ошибка|).
        naive = [abs(all_a[origin, j] - all_a[end, j]) / m["sd"][j] for j in range(3)]
        values.append({"target": str(idx[end]), "crps": per_var, "naive_persistence": naive})
    return values


def select(f: pd.DataFrame):
    """Сетка (R, b) → таблица CRPS; возвращает (выбор, сетка, trend_train, last_train_index)."""
    idx = pd.PeriodIndex(f.month, freq="M")
    last = int(np.flatnonzero(idx <= pd.Period(TRAIN_END))[-1])
    a0, trend = observations(f.iloc[:last + 1])
    all_a, _ = observations(f, trend)
    scores = []
    for k in REGIME_GRID:
        m = le.model(a0, k)
        for block in BLOCK_GRID:
            vals = standardized_crps_targets(f, m, all_a, last, block, idx)
            joint = float(np.mean([np.mean(v["crps"]) for v in vals]))
            naive = float(np.mean([np.mean(v["naive_persistence"]) for v in vals]))
            scores.append({"regimes": k, "block_months": block,
                           "joint_standardized_CRPS_13months": joint,
                           "per_variable_CRPS": np.mean([v["crps"] for v in vals], axis=0).tolist(),
                           "naive_persistence_joint_CRPS": naive,
                           "n_validation_targets": len(vals)})
    choice = min(scores, key=lambda r: r["joint_standardized_CRPS_13months"])
    return choice, scores, trend, last


def regime_stats(final, f: pd.DataFrame, block: int):
    """Статистика режимов для меню §2.6б: доля месяцев, σ остатков по переменным (исходные единицы),
    средняя длительность, матрица переходов, метка «кризис» = режим с максимальной дисперсией."""
    h = final["hmm"]
    labels = h["filtered"].argmax(1)
    idx = pd.PeriodIndex(f.month, freq="M")[1:]          # остаток t относится к месяцу t+1
    r = final["resid"] * final["sd"]                     # остатки в исходных единицах признаков
    P = h["P"]
    w, v = np.linalg.eig(P.T)
    stat = np.real(v[:, np.argmin(abs(w - 1))])
    stat = stat / stat.sum()
    out = []
    for j in range(h["k"]):
        mask = labels == j
        sd = r[mask].std(0, ddof=1) if mask.sum() > 1 else np.zeros(3)
        runs, cur = [], 0
        for lab in labels:
            if lab == j:
                cur += 1
            elif cur:
                runs.append(cur)
                cur = 0
        if cur:
            runs.append(cur)
        out.append({"index": j, "share_of_history": float(mask.mean()), "n_months": int(mask.sum()),
                    "stationary_prob": float(stat[j]),
                    "resid_sd": {"log_cpi_pp": float(sd[0]), "real_key_pp": float(sd[1]), "log_fx_pct": float(sd[2])},
                    "mean_duration_months": float(np.mean(runs)) if runs else 0.0,
                    "months": [str(p) for p in idx[mask]],
                    "stay_prob": float(P[j, j]), "stay_prob_block": float(np.linalg.matrix_power(P, block)[j, j])})
    tot = [sum(o["resid_sd"].values()) for o in out]
    crisis = int(np.argmax(tot))
    for o in out:
        o["label"] = "кризис (макс. дисперсия)" if o["index"] == crisis and h["k"] > 1 else \
                     ("спокойный" if h["k"] > 1 else "единственный")
    return {"regimes": out, "transition": P.tolist(), "crisis_index": crisis,
            "note": "режим навязанный на горизонт — стресс, не прогноз (§2.6б)"}


def student_quantiles(resid):
    """Квантили неограниченного Student-t (MLE по остаткам, стандартизованные единицы) для
    квантильного стресса: только квантили, не ожидания (RJMF §6)."""
    out = []
    for j in range(3):
        df, loc, scale = stats.t.fit(resid[:, j])
        out.append({"df": float(df), "loc": float(loc), "scale": float(scale),
                    "quantiles": {str(q): float(stats.t.ppf(q, df, loc, scale)) for q in STRESS_QUANTILES}})
    return out


def export_params(final, trend, block, choice, scores, f: pd.DataFrame, meta: dict, learning: dict):
    """JSON-паспорт генератора для `sample.py` и C++ `MacroSampler` (всё, что нужно выборке)."""
    h = final["hmm"]
    N = len(final["resid"])
    labels = h["filtered"].argmax(1)
    lastrow = f.iloc[-1]
    return {
        "schema": "maos.macro_params/1",
        "origin": "порт RJMF Methodology §6/§6.1 (Бураков 2026; RJMF 2026); параметры оценены на cbr.ru",
        "trained_at": pd.Timestamp.now(tz="UTC").isoformat(),
        "data": {"source": "cbr.ru", "n": int(len(f)), "first": str(f.month.iloc[0]), "last": str(f.month.iloc[-1]),
                 "synthetic": 0, "sources": meta.get("sources", [])},
        "features": ["100·ln(1+π/100)", "i − π − 2", "100·ln S − (a + b·m)"],
        "mean": final["mean"].tolist(), "sd": final["sd"].tolist(), "A": final["A"].tolist(),
        "ridge": float(final["ridge"]), "spectral_radius": float(final["radius_after"]),
        "fx_trend": trend.tolist(), "t_last": int(len(f) - 1),
        "svd_vectors": final["svd_vectors"].tolist(), "svd_values": final["svd_values"].tolist(),
        "rank": int(final["rank"]),
        "hmm": {"k": int(h["k"]), "means": h["means"].tolist(), "var": h["var"].tolist(),
                "P": h["P"].tolist(), "pi": h["pi"].tolist(), "filtered_last": h["filtered"][-1].tolist(),
                "labels": labels.tolist(), "loglik": h["loglik"]},
        "resid": final["resid"].tolist(), "n_resid": N, "last": final["last"].tolist(),
        "regimes": int(choice["regimes"]), "block": int(block),
        "selection": {"choice": choice, "grid": scores, "train_end": TRAIN_END,
                      "validation_targets": f"{VALID_FROM}…{VALID_TO}, origin = target − 13",
                      "criterion": "joint standardized CRPS, 384 paths per target"},
        "last_obs": {"month": str(lastrow.month), "cpi_yoy_pp": float(lastrow.cpi_yoy_pp),
                     "key_pp": float(lastrow.key_end_pp), "usd_rub": float(lastrow.usd_rub_end)},
        "sigma_bb": meta.get("sigma_bb", {}),
        "student_t": student_quantiles(final["resid"]),
        "regime_stats": regime_stats(final, f, block),
        "tail_diagnostics": le.tails(final["resid"]),
        "usd_inflation": 0.02,                       # ППС-опора курса, π_USD [НОРМ]
        "validation": learning,
        "history": {"month": [str(p) for p in f.month], "cpi_yoy_pp": f.cpi_yoy_pp.tolist(),
                    "key_pp": f.key_end_pp.tolist(), "usd_rub": f.usd_rub_end.tolist()},
    }
