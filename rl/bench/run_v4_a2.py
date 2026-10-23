"""V4 (A2): «CP-SAT в продукте» и «ГА с тёплым стартом CP-SAT» + «цена детерминизма».

    rl/.venv/bin/python -m rl.bench.run_v4_a2 --cpsat-sec 60 --out rl/results/v4_a2.json

Детерминированно (средние длительности, без поломок — как V4 A1):
- правила — серийная схема ядра (= run_schedule), лучшее по F = Cmax + 0.5·Σпросрочки;
- CP-SAT в продукте — полная модель rl/bench/cpsat_full.py (наладки, рабочие, календари) с подсказкой
  лучшего правила; Cmax/F воспроизведения пинами «не раньше старта + станок» в sim_place (как в продукте);
- ГА структурный (A1: 5 весов + сдвиги заказов, затравки — правила) — «до тёплого старта»;
- ГА по операциям, затравки — правила (абляция: эффект хромосомы без CP-SAT);
- ГА по операциям, затравки — старты CP-SAT + правила, станки CP-SAT — «после тёплого старта».
На экземплярах MAOS (обогащённая НСИ) — стохастика: жёсткий план CP-SAT (пины) против робастно
донастроенного ГА (обучение — сценарии seed 1000…1007) на ОТЛОЖЕННЫХ сценариях (seed 2026102201+i, CRN),
парный бутстреп ΔE/ΔCVaR Cmax и F по сценариям; сводка по экземплярам — IQM и бутстреп по экземплярам.
"""
from __future__ import annotations

import argparse
import json
import math
import time
from pathlib import Path

import numpy as np

from rl.bench import instances as bi
from rl.bench.cpsat_full import payload_from_instance, solve_payload
from rl.env.core import load_module, make_config, run_rule
from rl.train.common import iqm, paired_bootstrap_ci

RULES = ["EDD", "SPT", "LPT", "CR", "MWKR", "MS", "FIFO"]
HOLDOUT_SEED = 2026102201          # [НОРМ] rl.holdout
GA_TRAIN_SEED0, GA_NS = 1000, 8    # [К] rl.ga_baseline
ALPHA = 0.10
STALL = 40                         # [К] ГА по операциям на стенде: поколений без улучшения до остановки (в продукте — 8)


def opkey_from_key(key: list[float]) -> list[float]:
    """Нормированный ранг ключа (равные — по индексу, как очередь simulate) ∈ [0, 1]."""
    order = sorted(range(len(key)), key=lambda i: (key[i], i))
    out = [0.0] * len(key)
    den = max(1, len(key) - 1)
    for r, i in enumerate(order):
        out[i] = r / den
    return out


def F(row: dict) -> float:
    return row["makespan_h"] + 0.5 * row["tardiness_h"]


def det_part(me, name: str, js: dict, cpsat_sec: float, ga_sec: float, ga_gens: int) -> tuple[dict, dict]:
    inst = me.Instance.from_json(json.dumps(js))
    det = me.SimEnv(inst, make_config({"event_mode": False, "deterministic": True, "breakdowns": False, "dense_reward": False}))
    res: dict = {"name": name, "n_jobs": det.n_jobs, "rules": {}}
    gantts = {}
    for r in RULES:
        row = run_rule(det, r, 1)
        res["rules"][r] = {"makespan_h": row["makespan_h"], "tardiness_h": row["tardiness_h"], "F_h": F(row)}
        gantts[r] = json.loads(det.gantt())
    best = min(RULES, key=lambda r: res["rules"][r]["F_h"])
    res["best_rule"] = best
    g = gantts[best]
    p = payload_from_instance(js)
    p.update({"time_limit_s": cpsat_sec, "workers": 8, "seed": 42, "w_tard": 0.5,
              "hint": {"starts": [x["start"] * 60 for x in g], "machines": [x["machine_id"] for x in g],
                       "makespan": res["rules"][best]["makespan_h"] * 60}})
    t0 = time.time()
    cp = solve_payload(p)
    res["cpsat"] = {"status": cp.status, "objective_min": cp.objective if math.isfinite(cp.objective) else None,
                    "bound_min": cp.bound, "sec": time.time() - t0, "setup_mode": cp.setup_mode, "routing": cp.routing,
                    "calendar_mode": cp.calendar_mode, "n_conservative": cp.n_conservative}
    cpd: dict = {}
    if cp.starts:
        key_cp = opkey_from_key(cp.starts)
        rep = json.loads(me.simulate_plan(det, key_cp, cp.starts, cp.machines, 0))
        res["cpsat"].update({"makespan_h": rep["makespan_h"], "tardiness_h": rep["tardiness_h"], "F_h": F(rep),
                             "solver_makespan_h": cp.makespan / 60})
        cpd = {"starts": cp.starts, "machines": cp.machines, "key": key_cp}
    rule_seeds = [opkey_from_key(list(me.rule_key(det, r))) for r in [best] + [r for r in RULES if r != best]]
    t0 = time.time()
    ga = json.loads(me.ga_improve(det, ga_gens, 1, 1, ga_sec, RULES))
    res["ga_structured"] = {"F_h": ga["best_score"], "sec": time.time() - t0, "generations": ga["generations"]}
    t0 = time.time()
    gr = json.loads(me.ga_improve_keys(det, rule_seeds, [], 400, 0, 1000, ga_sec, 1991, STALL))
    res["ga_opkeys_rules"] = {"F_h": gr["best_score"], "seed_F_h": gr["seed_score"], "sec": time.time() - t0, "generations": gr["generations"]}
    if cpd:
        t0 = time.time()
        gw = json.loads(me.ga_improve_keys(det, [cpd["key"]] + rule_seeds, cpd["machines"], 400, 0, 1000, ga_sec, 1991, STALL))
        res["ga_warm"] = {"F_h": gw["best_score"], "seed_F_h": gw["seed_score"], "sec": time.time() - t0, "generations": gw["generations"]}
        cpd["rule_seeds"] = rule_seeds
    return res, cpd


def stochastic_part(me, js: dict, cpd: dict, best_rule: str, n_hold: int, ga_sec: float) -> dict:
    """Цена детерминизма: жёсткий CP-SAT против робастного ГА (тёплый старт) на отложенных сценариях."""
    inst = me.Instance.from_json(json.dumps(js))
    sto = me.SimEnv(inst, make_config({"event_mode": False, "deterministic": False, "breakdowns": True, "dense_reward": False}))
    t0 = time.time()
    gr = json.loads(me.ga_improve_keys(sto, [cpd["key"]] + cpd["rule_seeds"], cpd["machines"], 200, GA_NS, GA_TRAIN_SEED0, ga_sec, 1991, STALL))
    robust_key = gr["best_key"]
    ga_sec_used = time.time() - t0
    rule_key = list(me.rule_key(sto, best_rule))
    plans = {"rule": (rule_key, [], []), "cpsat_rigid": (cpd["key"], cpd["starts"], cpd["machines"]),
             "cpsat_dispatch": (cpd["key"], [], cpd["machines"]), "ga_robust": (robust_key, [], cpd["machines"])}
    vals: dict = {k: {"mk": [], "F": []} for k in plans}
    for i in range(n_hold):
        for k, (key, st, mc) in plans.items():
            r = json.loads(me.simulate_plan(sto, key, st, mc, HOLDOUT_SEED + i))
            vals[k]["mk"].append(r["makespan_h"]); vals[k]["F"].append(F(r))
    out: dict = {"n_holdout": n_hold, "ga_train_scen": GA_NS, "ga_sec": ga_sec_used, "plans": {}}
    for k, v in vals.items():
        mk, f = np.array(v["mk"]), np.array(v["F"])
        kk = max(1, int(ALPHA * len(mk)))
        out["plans"][k] = {"E_mk_h": float(mk.mean()), "CVaR_mk_h": float(np.sort(mk)[-kk:].mean()),
                           "E_F_h": float(f.mean()), "CVaR_F_h": float(np.sort(f)[-kk:].mean())}
    out["delta"] = {}
    for a, b in (("ga_robust", "cpsat_rigid"), ("cpsat_dispatch", "cpsat_rigid"), ("cpsat_rigid", "rule"), ("ga_robust", "rule")):
        out["delta"][f"{a}-{b}"] = {m: _paired(vals[a][m], vals[b][m]) for m in ("mk", "F")}
    return out


def _paired(x: list[float], y: list[float], b: int = 2000, seed: int = 7) -> dict:
    """Δ = x − y по сценариям: среднее и CVaR_α (верхний хвост) с парным бутстреп-ДИ."""
    x, y = np.asarray(x), np.asarray(y)
    rng = np.random.default_rng(seed)
    n = len(x)
    kk = max(1, int(ALPHA * n))
    cv = lambda v: float(np.sort(v)[-kk:].mean())  # noqa: E731
    bm, bc = [], []
    for _ in range(b):
        idx = rng.integers(0, n, n)
        bm.append(float((x[idx] - y[idx]).mean())); bc.append(cv(x[idx]) - cv(y[idx]))
    return {"d_mean": float((x - y).mean()), "ci_mean": [float(np.percentile(bm, 2.5)), float(np.percentile(bm, 97.5))],
            "d_cvar": cv(x) - cv(y), "ci_cvar": [float(np.percentile(bc, 2.5)), float(np.percentile(bc, 97.5))]}


def summarize(results: list[dict]) -> dict:
    """Сводка по экземплярам: разрывы к BKS до/после тёплого старта; относительная цена детерминизма (IQM, ДИ)."""
    out: dict = {"gap_bks_pct": {}, "price_rel": {}}
    bench = [r for r in results if r.get("bks")]
    for k in ("best_rule", "ga_structured", "ga_opkeys_rules", "cpsat", "ga_warm"):
        g = [r["gap_bks_pct"][k] for r in bench if r.get("gap_bks_pct", {}).get(k) is not None]
        if g:
            out["gap_bks_pct"][k] = {"mean": float(np.mean(g)), "median": float(np.median(g)), "n": len(g)}
    maos = [r for r in results if "stochastic" in r]
    for pair in ("ga_robust-cpsat_rigid", "cpsat_dispatch-cpsat_rigid", "cpsat_rigid-rule", "ga_robust-rule"):
        a, b = pair.split("-")
        for m, base_key in (("mk", "E_mk_h"), ("F", "E_F_h")):
            d = np.array([r["stochastic"]["delta"][pair][m]["d_mean"] / max(1e-9, r["stochastic"]["plans"][b][base_key]) for r in maos])
            dc = np.array([r["stochastic"]["delta"][pair][m]["d_cvar"] / max(1e-9, r["stochastic"]["plans"][b][base_key.replace("E_", "CVaR_")]) for r in maos])
            if len(d):
                mi, lo, hi = paired_bootstrap_ci(d)
                ci, clo, chi = paired_bootstrap_ci(dc)
                out["price_rel"][f"{pair}:{m}"] = {"iqm_rel_mean": mi, "ci95": [lo, hi], "iqm_rel_cvar": ci, "ci95_cvar": [clo, chi],
                                                   "n_instances": len(d)}
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cpsat-sec", type=float, default=60.0)
    ap.add_argument("--ga-sec", type=float, default=20.0)
    ap.add_argument("--ga-gens", type=int, default=30)
    ap.add_argument("--n-hold", type=int, default=100)
    ap.add_argument("--only", type=str, default="")
    ap.add_argument("--out", type=Path, default=bi.REPO / "rl" / "results" / "v4_a2.json")
    a = ap.parse_args()
    me = load_module()
    index = json.loads((bi.OUT / "index.json").read_text(encoding="utf-8"))
    results = []
    for name, meta in index.items():
        if a.only and a.only not in name:
            continue
        js = json.loads((bi.OUT / f"{name}.json").read_text(encoding="utf-8"))
        t0 = time.time()
        r, cpd = det_part(me, name, js, a.cpsat_sec, a.ga_sec, a.ga_gens)
        r["bks"], r["lb"] = bi.BKS.get(name), meta.get("lb")
        ref = r["bks"]
        if ref:
            ms = lambda v: 100 * (v - ref) / ref  # noqa: E731 — бенчмарки без сроков: F = Cmax (ч = мин·1/60 → в минутах как BKS)
            r["gap_bks_pct"] = {"best_rule": ms(r["rules"][r["best_rule"]]["F_h"] * 60), "ga_structured": ms(r["ga_structured"]["F_h"] * 60),
                                "ga_opkeys_rules": ms(r["ga_opkeys_rules"]["F_h"] * 60),
                                "cpsat": ms(r["cpsat"]["F_h"] * 60) if "F_h" in r["cpsat"] else None,
                                "ga_warm": ms(r["ga_warm"]["F_h"] * 60) if "ga_warm" in r else None}
        if name.startswith("maos") and cpd:
            r["stochastic"] = stochastic_part(me, js, cpd, r["best_rule"], a.n_hold, a.ga_sec)
        r["sec"] = time.time() - t0
        results.append(r)
        cps = r["cpsat"]
        print(f"{name:11s} J={r['n_jobs']:5d} rule {r['best_rule']:4s} F={r['rules'][r['best_rule']]['F_h']:9.2f}  "
              f"GAs={r['ga_structured']['F_h']:9.2f} GAk={r['ga_opkeys_rules']['F_h']:9.2f} "
              f"CP={cps.get('F_h', float('nan')):9.2f} ({cps['status']},{cps['routing']},{cps['calendar_mode']}) "
              f"GAw={r.get('ga_warm', {}).get('F_h', float('nan')):9.2f}  [{r['sec']:.0f}s]", flush=True)
        if "stochastic" in r:
            d = r["stochastic"]["delta"]["ga_robust-cpsat_rigid"]["mk"]
            print(f"   цена детерминизма ΔE[Cmax] {d['d_mean']:+.1f} ч ДИ [{d['ci_mean'][0]:+.1f}; {d['ci_mean'][1]:+.1f}]  "
                  f"ΔCVaR {d['d_cvar']:+.1f} ДИ [{d['ci_cvar'][0]:+.1f}; {d['ci_cvar'][1]:+.1f}]", flush=True)
        a.out.parent.mkdir(parents=True, exist_ok=True)
        merged = results
        if a.only and a.out.exists():                 # частичный перезапуск: заменить только пересчитанные
            prev = json.loads(a.out.read_text(encoding="utf-8"))["results"]
            done = {x["name"] for x in results}
            merged = [x if x["name"] not in done else next(y for y in results if y["name"] == x["name"]) for x in prev] + \
                     [y for y in results if y["name"] not in {x["name"] for x in prev}]
        a.out.write_text(json.dumps({"cpsat_sec": a.cpsat_sec, "ga_sec": a.ga_sec, "results": merged,
                                     "summary": summarize(merged)}, indent=1, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    main()
