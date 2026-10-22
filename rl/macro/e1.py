"""E1 (METHODOLOGY-V2 §1 Н1, §11.6 волна M): распределение Π и C_min ОДНОГО И ТОГО ЖЕ плана при
(а) i.i.d. ценах v0.63 (общий фактор M ~ N(0,1), ставка — константа fin_params) и (б) обученном
макро-генераторе (F из SVD-инноваций, pass-through курса/инфляции, ставка по сценарию).
CRN: сценарий i в (а) и (б) использует те же идиосинкратические числа — разность парная.

Запуск при работающем сервере: `rl/.venv/bin/python -m rl.macro.e1 [--base URL] [--samples 2000]`.
Пишет docs/research/M1-e1-results.json.
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np
import requests

OUT = Path(__file__).resolve().parents[2] / "docs" / "research" / "M1-e1-results.json"


def cvar_lower(v, alpha):
    a = np.sort(np.asarray(v, float))
    k = max(1, int(np.floor(alpha * len(a))))
    return float(a[:k].mean())


def paired_bootstrap(stat, a, b, B=1000, seed=42):
    """ДИ 95 % для stat(b) − stat(a) при парной выборке сценариев (CRN)."""
    rng = np.random.default_rng(seed)
    n = len(a)
    diffs = []
    for _ in range(B):
        idx = rng.integers(0, n, n)
        diffs.append(stat(np.asarray(b)[idx]) - stat(np.asarray(a)[idx]))
    return [float(np.quantile(diffs, 0.025)), float(np.quantile(diffs, 0.975))]


def metrics(per, alpha, beta):
    pr, mc, br = np.asarray(per["profit"]), np.asarray(per["min_cash"]), np.asarray(per["breach"])
    return {"expected_profit": float(pr.mean()), "cvar_profit": cvar_lower(pr, alpha),
            "cvar_min_cash": cvar_lower(mc, beta), "p_breach": float(br.mean()),
            "min_cash_p50": float(np.median(mc)), "interest_mean": float(np.mean(per["interest"]))}


def run(base: str, samples: int, cash_samples: int, seed: int, scenario: str | None):
    s = requests.Session()
    tok = s.post(f"{base}/api/auth/login", json={"login": "admin", "password": "maos2025"}, timeout=60).json()["data"]["token"]
    s.headers["Authorization"] = f"Bearer {tok}"
    common = {"samples": samples, "cash_samples": cash_samples, "seed": seed, "pol_curve": False, "cash": True}
    if scenario:
        common["scenario_id"] = scenario
    t0 = time.time()
    plan = s.post(f"{base}/api/optimize/cash", json={**common, "macro_mode": "iid_v063"}, timeout=600).json()["data"]
    t_plan = time.time() - t0
    lp = plan["cash_lp"]
    x = {it["product_id"]: it["qty"] for it in lp["portfolio"]}
    alpha, beta = plan["alpha"], lp["beta"]
    modes = {"iid_v063": "iid_v063", "learned_base": "base",
             "stress_regime_crisis": {"mode": "regime", "stress": {"regime": 1}},
             "stress_quantile_095": {"mode": "quantile", "stress": {"quantile_t": 0.95}},
             "stress_quantile_005": {"mode": "quantile", "stress": {"quantile_t": 0.05}}}
    res, timings = {}, {"plan_lp_s": t_plan}
    for name, mm in modes.items():
        t1 = time.time()
        r = s.post(f"{base}/api/optimize/cash", json={**common, "macro_mode": mm, "eval_portfolio": x}, timeout=600).json()["data"]
        timings[name + "_s"] = time.time() - t1
        fp = r["cash_lp"]["fixed_portfolio"]
        res[name] = {"metrics": metrics(fp["per_scenario"], alpha, beta), "gross": fp["gross"],
                     "waterfall_rule": {k: fp["waterfall_rule"][k] for k in ("cfar", "cfar_ci", "p_breach", "p_breach_ci", "dscr_min_p05", "debt_peak_share", "int_cost")},
                     "macro": r.get("macro"), "per_scenario": fp["per_scenario"]}
    a = res["iid_v063"]["per_scenario"]
    deltas = {}
    for name in ("learned_base", "stress_regime_crisis", "stress_quantile_095", "stress_quantile_005"):
        b = res[name]["per_scenario"]
        deltas[name] = {
            "d_cvar_profit": res[name]["metrics"]["cvar_profit"] - res["iid_v063"]["metrics"]["cvar_profit"],
            "d_cvar_profit_ci": paired_bootstrap(lambda v: cvar_lower(v, alpha), a["profit"], b["profit"]),
            "d_cvar_min_cash": res[name]["metrics"]["cvar_min_cash"] - res["iid_v063"]["metrics"]["cvar_min_cash"],
            "d_cvar_min_cash_ci": paired_bootstrap(lambda v: cvar_lower(v, beta), a["min_cash"], b["min_cash"]),
            "d_p_breach": res[name]["metrics"]["p_breach"] - res["iid_v063"]["metrics"]["p_breach"],
            "d_p_breach_ci": paired_bootstrap(lambda v: float(np.mean(v)), a["breach"], b["breach"]),
            "d_expected_profit": res[name]["metrics"]["expected_profit"] - res["iid_v063"]["metrics"]["expected_profit"],
            "d_expected_profit_ci": paired_bootstrap(lambda v: float(np.mean(v)), a["profit"], b["profit"]),
        }
    out = {"plan": {"items": x, "n_items": len(x), "objective": plan["objective"], "alpha": alpha, "beta": beta,
                    "samples": samples, "cash_samples": cash_samples, "seed": seed, "horizon_weeks": lp["horizon_weeks"],
                    "scenario_id": scenario, "lp_cvar_profit_iid": lp["cvar"], "lp_expected_iid": lp["expected"]},
           "results": {k: {kk: vv for kk, vv in v.items() if kk != "per_scenario"} for k, v in res.items()},
           "paired_deltas_vs_iid": deltas, "timings_s": timings,
           "note": "один план (LP при iid_v063) оценён через водопад (правило выборки) на N сценариях каждого режима; CRN по i; парный бутстреп B=1000"}
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1))
    return out


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:8080")
    ap.add_argument("--samples", type=int, default=2000)
    ap.add_argument("--cash-samples", type=int, default=2000)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--scenario", default=None)
    a = ap.parse_args()
    o = run(a.base, a.samples, a.cash_samples, a.seed, a.scenario)
    print(json.dumps({"plan": {k: v for k, v in o["plan"].items() if k != "items"},
                      "metrics": {k: v["metrics"] for k, v in o["results"].items()},
                      "deltas": o["paired_deltas_vs_iid"], "timings": o["timings_s"]}, ensure_ascii=False, indent=1))
