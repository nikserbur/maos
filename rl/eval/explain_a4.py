"""Примеры выученных решений A4: где RL отклоняется от C* и что это даёт (на ВАЛИДАЦИИ или holdout, CRN).

    rl/.venv/bin/python -m rl.eval.explain_a4 --ckpt rl/train/checkpoints/l4C_seed1_best.pt --kind hold --n 40

Для каждого экземпляра: эпизоды RL и C* на одних и тех же сценариях; решения RL, отличные от хода C* на том же
наблюдении, с признаками последствий (чистая выгода сверхурочных/субподряда, ΔCVaR кандидатов, запас ликвидности,
неделя, триггер) и разностью прибыли эпизода. Пишет rl/results/a4/explain_a4.json.
"""
from __future__ import annotations

import argparse
import json
from concurrent.futures import ProcessPoolExecutor

import numpy as np

from rl.env.l3_env import ACTS, F
from rl.eval.a4_common import A4_RES, F4, load4, run4, save, scen4, set_names, value_of


def _one(args):
    name, ckpt, kind, n, ch = args
    import torch
    from rl.train.train_l4 import ActorCritic, policy_fn, teacher
    torch.set_num_threads(1)
    net = ActorCritic(); net.load_state_dict(torch.load(ckpt, map_location="cpu", weights_only=True)); net.eval()
    spec = f"{ch['C*']}|{ch['LA*']}"
    pol, tch = policy_fn(net, spec, False, None), teacher(spec)
    inst, v = load4(name), value_of(name)
    sc, base = scen4(kind, n)
    idx = list(range(n))
    rl = run4(inst, pol, sc, base, idx, ch["rule"], record=True)
    cs = run4(inst, tch, sc, base, idx, ch["rule"])
    dev, kinds = [], {}
    for i, (r, c) in enumerate(zip(rl, cs)):
        for o, m, a in r["_traj"]:
            t = int(np.asarray(tch(o[None], m[None].astype(bool)))[0]) if tch is not None else 0
            if a == t:
                continue
            key = f"{ACTS[t]}→{ACTS[a]}"
            kinds[key] = kinds.get(key, 0) + 1
            if len(dev) < 12:
                dev.append({"scenario": i, "week": round(float(o[F["week"]]) * 26, 1), "shock_epoch": bool(o[F["shock_epoch"]] > 0.5),
                            "cstar": ACTS[t], "rl": ACTS[a], "ot_net_pctV": float(o[F4["ot_net"]]), "out_net_pctV": float(o[F4["out_net"]]),
                            "inv_dcvar_pctV": [float(o[F4["inv"] + 4 * c]) for c in range(3)],
                            "inv_dpgap": [float(o[F4["inv"] + 4 * c + 2]) for c in range(3)],
                            "liq_V": float(o[F4["liq"]]), "late_value": float(o[F["late_value"]]), "rho_rem": float(o[F["rho_rem"]]),
                            "d_profit_episode_pctV": 100 * (r["profit"] - c["profit"]) / v})
    d = np.array([100 * (r["profit"] - c["profit"]) / v for r, c in zip(rl, cs)])
    return name, {"switches": kinds, "examples": dev, "d_profit_mean": float(d.mean()), "d_profit_worst10": float(np.sort(d)[: max(1, n // 10)].mean()),
                  "share_changed": float(np.mean(np.abs(d) > 1e-9))}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", required=True)
    ap.add_argument("--kind", default="hold")
    ap.add_argument("--n", type=int, default=40)
    ap.add_argument("--sets", nargs="+", default=["A3", "F"])
    ap.add_argument("--workers", type=int, default=9)
    a = ap.parse_args()
    ch = json.loads((A4_RES / "champions_a4.json").read_text(encoding="utf-8"))
    names = [n for X in a.sets for n in set_names(X)]
    with ProcessPoolExecutor(a.workers) as ex:
        res = dict(ex.map(_one, [(n, a.ckpt, a.kind, a.n, ch[n]) for n in names]))
    tot: dict = {}
    for r in res.values():
        for k, c in r["switches"].items():
            tot[k] = tot.get(k, 0) + c
    save(A4_RES / "explain_a4.json", {"ckpt": a.ckpt, "kind": a.kind, "n": a.n, "switches_total": tot, "per_instance": res})
    print(json.dumps(dict(sorted(tot.items(), key=lambda x: -x[1])[:20]), ensure_ascii=False))


if __name__ == "__main__":
    main()
