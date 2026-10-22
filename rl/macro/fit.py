"""Обучение макро-генератора: `python -m rl.macro.fit [--no-holdout] [--data CSV]`.

Пишет `rl/macro/params/macro_params.json` (всё, что нужно сэмплеру: A, масштабы, базис SVD,
HMM, блоки остатков по режимам, выбор (R, b), таблица CRPS) и `rl/macro/params/learning.json`
(протокол V1: сетка выбора, отложенное покрытие, диагностика хвостов).
Синтетические строки (`synthetic=1`) запрещены — `data.load_monthly` отказывает (§3.3, Р7).
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np

from . import learning as le
from .anchored import export_params, observations, select
from .data import OUT, PARAMS, dump, load_monthly
from .validate import holdout, summarize


def fit(data_csv: Path | None = None, run_holdout: bool = True, out_dir: Path = PARAMS) -> dict:
    t0 = time.time()
    f = load_monthly(data_csv)
    meta = json.loads((OUT / "meta.json").read_text()) if (OUT / "meta.json").exists() else {}
    choice, scores, _, _ = select(f)
    t_sel = time.time() - t0
    a, trend = observations(f)
    final = le.model(a, choice["regimes"])
    block = int(choice["block_months"])
    learning = {
        "selection": choice, "validation_grid": scores,
        "train_end": "2019-12", "validation_targets": "2021-01…2022-12 (24 цели, origin = target − 13)",
        "selection_no_2024_26_outcomes": True,
        "data_n": int(len(f)), "last_observation": str(f.month.iloc[-1]),
        "rank": int(final["rank"]), "rank_rule": "90 % энергии SVD остатков обучения (предобъявлено)",
        "ridge": float(final["ridge"]), "ridge_scores": final["ridge_scores"],
        "spectral_radius": {"before": float(final["radius_before"]), "after": float(final["radius_after"])},
        "SVD_orthogonality_is_not_independence": True,
        "tail_diagnostics": le.tails(final["resid"]),
        "carrier": "конечные совместные эмпирические блоки остатков, условные на фильтрованный режим HMM; "
                   "неограниченный лог-Student — только квантильный стресс",
        "timings_s": {"selection": t_sel},
        "limitations": ["пересмотренная история, не реальные винтажи",
                        "24 перекрывающихся цели — точность выбора гиперпараметров ограничена",
                        "внутренние параметры предприятия из макро-рядов не выводятся"],
    }
    if run_holdout:
        t1 = time.time()
        rows = holdout(f, choice["regimes"], block)
        learning["holdout"] = summarize(rows)
        learning["holdout_rows"] = rows
        learning["timings_s"]["holdout"] = time.time() - t1
    learning["timings_s"]["total"] = time.time() - t0
    params = export_params(final, trend, block, choice, scores, f, meta, {k: v for k, v in learning.items() if k != "holdout_rows"})
    out_dir.mkdir(parents=True, exist_ok=True)
    dump(out_dir / "macro_params.json", params)
    dump(out_dir / "learning.json", learning)
    return learning


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--data", type=Path, default=None)
    p.add_argument("--no-holdout", action="store_true")
    p.add_argument("--out", type=Path, default=PARAMS)
    args = p.parse_args()
    rep = fit(args.data, not args.no_holdout, args.out)
    print(json.dumps({"selection": rep["selection"], "rank": rep["rank"], "radius": rep["spectral_radius"],
                      "holdout": rep.get("holdout", {}).get("variables"), "timings_s": rep["timings_s"]},
                     ensure_ascii=False, indent=1, default=float))
