"""Фикстуры для GoogleTest `backend/tests/test_macrosampler.cpp`: маленькие синтетические параметры
генератора + ожидаемые пути `sample.py` (побитовое совпадение C++ с Python при одном seed).

`python -m rl.macro.make_fixture` → backend/tests/fixtures/macro_params_small.json, macro_expected.json.
Синтетика здесь — только тест-вектор для сэмплера, не данные обучения (§11.5).
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

from . import learning as le
from .anchored import export_params, observations
from .sample import BRIDGE_STREAM, MAX_WEEKS, Sampler

FIXTURES = Path(__file__).resolve().parents[2] / "backend" / "tests" / "fixtures"


def small_params(n_months: int = 40, seed: int = 21) -> dict:
    rng = np.random.default_rng(seed)
    A = np.array([[0.6, 0.1, 0.0], [0.05, 0.5, 0.1], [0.0, 0.1, 0.7]])
    z = np.zeros((n_months, 3))
    for t in range(1, n_months):
        z[t] = z[t - 1] @ A + rng.standard_normal(3) * (2.0 if 15 <= t < 25 else 0.7)
    f = pd.DataFrame({"month": [str(pd.Period("2020-01", freq="M") + i) for i in range(n_months)],
                      "cpi_yoy_pp": 6 + z[:, 0], "key_end_pp": 10 + z[:, 1] + z[:, 0],
                      "usd_rub_end": 70 * np.exp((z[:, 2] + 0.2 * np.arange(n_months)) / 100)})
    a, trend = observations(f)
    m = le.model(a, 2)
    choice = {"regimes": 2, "block_months": 2, "joint_standardized_CRPS_13months": 0.0}
    p = export_params(m, trend, 2, choice, [choice], f, {"sigma_bb": {"fx_pct_log": 3.0}}, {})
    p["data"]["sources"] = []
    p["history"] = {"month": p["history"]["month"]}              # для episode-стресса достаточно месяцев
    return p


def expected(p: dict) -> dict:
    s = Sampler(p)
    seed, n, W = 7, 3, 10
    r = s.sample(n, seed, horizon_weeks=W)
    H = r["months"]
    rgen = np.random.default_rng(np.random.SeedSequence([seed, 871]))
    u = rgen.random(8).tolist()
    rgb = np.random.default_rng(np.random.SeedSequence([seed, BRIDGE_STREAM]))
    rgb.bit_generator.advance(1 * 2 * MAX_WEEKS)
    ub = rgb.random(4).tolist()
    part = s.sample(1, seed, horizon_weeks=W, start_index=2)
    forced = s.sample(2, seed, horizon_months=H, stress={"regime": 1})
    quant = s.sample(1, seed, horizon_months=H, stress={"quantile_t": 0.95})
    ep = s.sample(1, seed, horizon_months=H, stress={"episode": p["history"]["month"][10], "months": 12})
    nodes = s.sample(1, seed, horizon_months=H, ref={"cpi": "nodes"})
    return {
        "seed": seed, "n": n, "weeks": W, "months": H,
        "uniforms_first8_stream871": u, "bridge_uniforms_first4_id1": ub,
        "z": r["z"].tolist(), "regime": r["regime"].tolist(), "block_id": r["block_id"].tolist(),
        "expected_z": r["expected_z"], "reference": r["reference"],
        "monthly": {k: v.tolist() for k, v in r["monthly"].items()},
        "weekly": {k: (v.tolist() if hasattr(v, "tolist") else v) for k, v in r["weekly"].items()},
        "start_index_2": {"z": part["z"].tolist(), "weekly_fx": part["weekly"]["fx"].tolist()},
        "forced_regime_1": {"z": forced["z"].tolist(), "regime": forced["regime"].tolist()},
        "quantile_095": {"z": quant["z"].tolist(), "cpi": quant["monthly"]["cpi"].tolist()},
        "episode": {"month": p["history"]["month"][10], "block_id": ep["block_id"].tolist(), "z": ep["z"].tolist()},
        "ref_nodes": {"cpi_ref": nodes["reference"]["cpi"], "cpi": nodes["monthly"]["cpi"].tolist()},
    }


if __name__ == "__main__":
    FIXTURES.mkdir(parents=True, exist_ok=True)
    p = small_params()
    (FIXTURES / "macro_params_small.json").write_text(json.dumps(p, ensure_ascii=False, indent=1))
    (FIXTURES / "macro_expected.json").write_text(json.dumps(expected(p), ensure_ascii=False, indent=1))
    print("fixtures written:", FIXTURES)
