"""Статические ключи для базовых линий V5-A3 (rl/eval/prereg_a3.md §4 пп. 2–3): CP-SAT и ГА с тёплым стартом CP-SAT.

    rl/.venv/bin/python -m rl.bench.keys_a3 --sec 60 --ga-sec 30 --workers 2    # → rl/results/a3/keys_a3.json

Детерминированно (средние): подсказка CP-SAT — лучшее правило по F = Cmax + 0.5·Σпросрочки; ключ = нормированный
ранг старта. ГА «ключи по операциям»: затравки — ключ CP-SAT и ранги 7 правил, станки CP-SAT, пригодность —
среднее F по 8 обучающим сценариям (seed 1000+, не holdout), 30 с.
"""
from __future__ import annotations

import argparse
import json
import time
from concurrent.futures import ProcessPoolExecutor

from rl.bench.cpsat_full import payload_from_instance, solve_payload
from rl.bench.instances_a3 import OUT as A3_DIR
from rl.bench.run_v4_a2 import F, RULES, opkey_from_key
from rl.env.core import load_module, make_config, run_rule
from rl.eval.a3_common import A3_RES, a3_names, save

GA_SEED0, GA_NS = 1000, 8


def _one(args) -> tuple[str, dict]:
    name, sec, ga_sec, d = args
    me = load_module()
    js = json.loads((d / f"{name}.json").read_text(encoding="utf-8"))
    inst = me.Instance.from_json(json.dumps(js))
    det = me.SimEnv(inst, make_config({"event_mode": False, "deterministic": True, "breakdowns": False, "dense_reward": False}))
    best, bf, bg = None, float("inf"), None
    for r in RULES:
        row = run_rule(det, r, 1)
        if F(row) < bf:
            best, bf, bg = r, F(row), json.loads(det.gantt())
    p = payload_from_instance(js)
    p.update({"time_limit_s": sec, "workers": 4, "seed": 42, "w_tard": 0.5,
              "hint": {"starts": [x["start"] * 60 for x in bg], "machines": [x["machine_id"] for x in bg]}})
    t0 = time.time()
    cp = solve_payload(p)
    out = {"status": cp.status, "hint_rule": best, "hint_F_h": bf, "cpsat_sec": time.time() - t0, "key": None, "ga_key": None}
    if cp.starts:
        key = opkey_from_key(cp.starts)
        out["key"] = key
        rep = json.loads(me.simulate_plan(det, key, [], cp.machines, 0))
        out["cpsat_F_h"] = F(rep)
        sto = me.SimEnv(inst, make_config({"event_mode": False, "deterministic": False, "breakdowns": True, "dense_reward": False}))
        rule_seeds = [opkey_from_key(list(me.rule_key(sto, r))) for r in [best] + [r for r in RULES if r != best]]
        t0 = time.time()
        gw = json.loads(me.ga_improve_keys(sto, [key] + rule_seeds, cp.machines, 200, GA_NS, GA_SEED0, ga_sec, 1991, 40))
        out.update({"ga_key": gw["best_key"], "ga_score": gw["best_score"], "ga_seed_score": gw["seed_score"], "ga_sec": time.time() - t0})
    print(name, out["status"], best, f"CP-SAT {out['cpsat_sec']:.0f} с", flush=True)
    return name, out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sec", type=float, default=60.0)
    ap.add_argument("--ga-sec", type=float, default=30.0)
    ap.add_argument("--workers", type=int, default=2)
    ap.add_argument("--set", choices=["A3", "F"], default="A3")      # A4: свежий набор F (prereg_a4.md §4 п.2)
    a = ap.parse_args()
    if a.set == "F":
        from rl.eval.a4_common import A4_RES, F_DIR, set_names
        names, d, out = set_names("F"), F_DIR, A4_RES / "keys_a4f.json"
    else:
        names, d, out = a3_names(), A3_DIR, A3_RES / "keys_a3.json"
    with ProcessPoolExecutor(a.workers) as ex:
        res = dict(ex.map(_one, [(n, a.sec, a.ga_sec, d) for n in names]))
    save(out, res)


if __name__ == "__main__":
    main()
