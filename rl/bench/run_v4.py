"""V4: правила / ГА / CP-SAT на Taillard ta01–ta10, Brandimarte mk01–mk10 и экземплярах MAOS.

    rl/.venv/bin/python -m rl.bench.run_v4 --cpsat-sec 60 --out rl/results/v4_benchmarks.json

Детерминированно (средние длительности, без поломок): серийное списочное планирование (как
run_schedule), событийный non-delay режим SimEnv, ГА по ключам (та же хромосома, что в Стадии 1),
CP-SAT с лимитом времени. Разрыв = (Cmax − BKS)/BKS; к CP-SAT — (Cmax − Cmax_CP)/Cmax_CP.
На экземплярах MAOS дополнительно — стохастическая оценка правил (E и CVaR_0.1 Cmax, N сценариев CRN).
"""
from __future__ import annotations

import argparse
import json
import math
import time
from pathlib import Path

import numpy as np

from rl.bench import instances as bi
from rl.bench.cpsat import solve_from_env
from rl.env.core import load_module, make_config, run_rule, run_key

RULES = ["EDD", "SPT", "LPT", "CR", "MWKR", "MS", "FIFO"]


def strip_calendar(js: dict) -> dict:
    """Детерминированное сравнение с CP-SAT (без календарей): экземпляр MAOS в режиме 24×7."""
    j = dict(js); j["calendar"] = {"any": False, "days": []}; j["machine_calendars"] = {}
    return j


def eval_instance(me, name: str, js: dict, lb: float | None, cpsat_sec: float, ga_gens: int, n_scen: int) -> dict:
    inst_full = me.Instance.from_json(json.dumps(js))
    inst = me.Instance.from_json(json.dumps(strip_calendar(js))) if name.startswith("maos") else inst_full
    det_serial = me.SimEnv(inst, make_config({"event_mode": False, "deterministic": True, "breakdowns": False, "dense_reward": False}))
    det_event = me.SimEnv(inst, make_config({"event_mode": True, "deterministic": True, "breakdowns": False, "dense_reward": False}))
    res: dict = {"name": name, "n_jobs": det_serial.n_jobs, "lb": lb, "bks": bi.BKS.get(name), "rules": {}}
    for r in RULES:
        t0 = time.time()
        a = run_rule(det_serial, r, 1)
        b = run_rule(det_event, r, 1)
        res["rules"][r] = {"serial": a["makespan_h"] * 60, "event": b["makespan_h"] * 60,
                           "tard_serial_h": a["tardiness_h"], "tard_event_h": b["tardiness_h"], "sec": time.time() - t0}
    best_rule = min(RULES, key=lambda r: res["rules"][r]["serial"])
    res["best_rule"] = best_rule
    t0 = time.time()
    ga = json.loads(me.ga_improve(det_serial, ga_gens, 1, 1, 30.0, RULES))
    res["ga"] = {"makespan": ga["best_score"] * 60, "seed_score": ga["seed_score"] * 60, "evaluations": ga["evaluations"],
                 "generations": ga["generations"], "stopped": ga["stopped"], "sec": time.time() - t0}
    det_serial.reset(1)
    cp = solve_from_env(det_serial, cpsat_sec)
    res["cpsat"] = {"makespan": cp.makespan, "bound": cp.bound, "status": cp.status, "sec": cp.seconds}
    ref = res["bks"] or (cp.makespan if math.isfinite(cp.makespan) else None)
    if ref:
        res["gap_bks_pct"] = {"best_rule": 100 * (res["rules"][best_rule]["serial"] - ref) / ref,
                              "ga": 100 * (res["ga"]["makespan"] - ref) / ref,
                              "cpsat": 100 * (cp.makespan - ref) / ref if math.isfinite(cp.makespan) else None,
                              "lb": 100 * (lb - ref) / ref if lb else None}
    if math.isfinite(cp.makespan):
        res["gap_cpsat_pct"] = {"best_rule": 100 * (res["rules"][best_rule]["serial"] - cp.makespan) / cp.makespan,
                                "ga": 100 * (res["ga"]["makespan"] - cp.makespan) / cp.makespan}
    if n_scen > 0 and name.startswith("maos"):
        sto = me.SimEnv(inst_full, make_config({"event_mode": True, "deterministic": False, "breakdowns": True, "dense_reward": False}))
        res["stochastic"] = {}
        for r in RULES:
            mk = np.array([run_rule(sto, r, 1000 + s)["makespan_h"] for s in range(n_scen)])
            k = max(1, int(0.1 * n_scen))
            res["stochastic"][r] = {"mean_h": float(mk.mean()), "cvar10_h": float(np.sort(mk)[-k:].mean()), "n": n_scen}
    return res


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cpsat-sec", type=float, default=60.0)
    ap.add_argument("--ga-gens", type=int, default=30)
    ap.add_argument("--n-scen", type=int, default=50)
    ap.add_argument("--only", type=str, default="")
    ap.add_argument("--out", type=Path, default=bi.REPO / "rl" / "results" / "v4_benchmarks.json")
    a = ap.parse_args()
    me = load_module()
    if not bi.OUT.exists():
        bi.write_all()
    index = json.loads((bi.OUT / "index.json").read_text(encoding="utf-8"))
    results = []
    for name, meta in index.items():
        if a.only and a.only not in name:
            continue
        js = json.loads((bi.OUT / f"{name}.json").read_text(encoding="utf-8"))
        r = eval_instance(me, name, js, meta.get("lb"), a.cpsat_sec, a.ga_gens, a.n_scen)
        results.append(r)
        print(f"{name:12s} jobs={r['n_jobs']:5d} best_rule={r['best_rule']:4s} {r['rules'][r['best_rule']]['serial']:8.1f} "
              f"ga={r['ga']['makespan']:8.1f} cpsat={r['cpsat']['makespan']:8.1f} ({r['cpsat']['status']}, {r['cpsat']['sec']:.0f}s) "
              f"bks={r['bks']} lb={r['lb']}", flush=True)
    a.out.parent.mkdir(parents=True, exist_ok=True)
    if a.only and a.out.exists():                      # частичный перезапуск: заменить только пересчитанные
        prev = json.loads(a.out.read_text(encoding="utf-8"))
        names = {r["name"] for r in results}
        results = [r for r in prev["results"] if r["name"] not in names] + results
    a.out.write_text(json.dumps({"cpsat_sec": a.cpsat_sec, "ga_gens": a.ga_gens, "results": results}, indent=1, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    main()
