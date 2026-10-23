"""Перепись структурных ходов L2: сколько ходов не замаскировано на экземплярах MAOS (A2, PLAN-V2 §8 п.4).

    rl/.venv/bin/python -m rl.bench.moves_census            # → rl/results/a2_moves_census.json

Для каждого экземпляра (текущие = обогащённая демо-НСИ; a1/ = экземпляры волны A1) эпизод L2
по средним длительностям с L0 = EDD и L2 = noop; на каждой недельной эпохе считаются допустимые
действия маски по видам ходов. Отчёт: на неделе 0, максимум по эпохам и «хоть раз доступен».
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from rl.bench import instances as bi
from rl.env.core import load_module, make_config

KINDS = ["shift_plus", "shift_minus", "split", "merge", "outsource", "reroute", "reassign"]


def census(me, js: dict) -> dict:
    env = me.SimEnv(me.Instance.from_json(json.dumps(js)),
                    make_config({"event_mode": True, "deterministic": True, "breakdowns": False,
                                 "dense_reward": False, "l2_enabled": True}))
    env.reset(1)
    k_orders = 16
    week0: dict[str, int] | None = None
    peak = {k: 0 for k in KINDS + ["finance"]}
    epochs, guard = 0, 0
    while not env.done and guard < 5_000_000:
        guard += 1
        if env.level == 2:
            mask = env.mask_l2()
            counts = {kind: int(sum(mask[1 + i * k_orders: 1 + (i + 1) * k_orders])) for i, kind in enumerate(KINDS)}
            counts["finance"] = int(sum(mask[1 + len(KINDS) * k_orders:]))
            if week0 is None:
                week0 = counts
            for k, v in counts.items():
                peak[k] = max(peak[k], v)
            epochs += 1
            env.step(0)
            continue
        env.step_job(env.rule_choice("EDD"))
    return {"week0": week0 or {}, "peak": peak, "ever": [k for k, v in peak.items() if v > 0], "epochs": epochs}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, default=bi.REPO / "rl" / "results" / "a2_moves_census.json")
    a = ap.parse_args()
    me = load_module()
    res: dict = {}
    for tag, folder in (("a2", bi.OUT), ("a1", bi.OUT / "a1")):
        index = json.loads((folder / "index.json").read_text(encoding="utf-8"))
        res[tag] = {}
        for name in index:
            if not name.startswith("maos"):
                continue
            js = json.loads((folder / f"{name}.json").read_text(encoding="utf-8"))
            res[tag][name] = census(me, js)
            print(tag, name, res[tag][name]["week0"], "ever:", res[tag][name]["ever"], flush=True)
    a.out.write_text(json.dumps(res, indent=1, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    main()
