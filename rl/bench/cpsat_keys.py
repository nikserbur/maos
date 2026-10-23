"""Ключи CP-SAT для экземпляров MAOS (A2): статический план солвера как действие L0 и базовая линия V5.

    rl/.venv/bin/python -m rl.bench.cpsat_keys --sec 60      # → rl/results/cpsat_keys_a2.json

Детерминированно (средние): подсказка — лучшее правило по F = Cmax + 0.5·Σпросрочки; модель продукта
(rl/bench/cpsat_full.py); ключ = нормированный ранг старта (как opkey_from_starts в run_schedule).
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

from rl.bench import instances as bi
from rl.bench.cpsat_full import payload_from_instance, solve_payload
from rl.bench.run_v4_a2 import F, RULES, opkey_from_key
from rl.env.core import load_module, make_config, run_rule

OUT = bi.REPO / "rl" / "results" / "cpsat_keys_a2.json"


def solve_instance(me, js: dict, sec: float) -> dict:
    env = me.SimEnv(me.Instance.from_json(json.dumps(js)),
                    make_config({"event_mode": False, "deterministic": True, "breakdowns": False, "dense_reward": False}))
    best, bf, bg = None, float("inf"), None
    for r in RULES:
        row = run_rule(env, r, 1)
        if F(row) < bf:
            best, bf, bg = r, F(row), json.loads(env.gantt())
    p = payload_from_instance(js)
    p.update({"time_limit_s": sec, "workers": 8, "seed": 42, "w_tard": 0.5,
              "hint": {"starts": [x["start"] * 60 for x in bg], "machines": [x["machine_id"] for x in bg]}})
    t0 = time.time()
    cp = solve_payload(p)
    return {"status": cp.status, "objective_min": cp.objective if cp.starts else None, "hint_rule": best, "sec": time.time() - t0,
            "key": opkey_from_key(cp.starts) if cp.starts else None, "machines": cp.machines}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sec", type=float, default=60.0)
    ap.add_argument("--out", type=Path, default=OUT)
    a = ap.parse_args()
    me = load_module()
    index = json.loads((bi.OUT / "index.json").read_text(encoding="utf-8"))
    res = {}
    for name in index:
        if not name.startswith("maos"):
            continue
        js = json.loads((bi.OUT / f"{name}.json").read_text(encoding="utf-8"))
        res[name] = solve_instance(me, js, a.sec)
        print(name, res[name]["status"], res[name]["hint_rule"], round(res[name]["sec"]), flush=True)
        a.out.write_text(json.dumps(res), encoding="utf-8")


if __name__ == "__main__":
    main()
