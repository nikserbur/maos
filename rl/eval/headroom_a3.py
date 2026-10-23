"""H0 (rl/eval/prereg_a3.md §1, §8): запас структурных политик ДО обучения.

    rl/.venv/bin/python -m rl.eval.headroom_a3 --workers 9     # → rl/results/a3/headroom_a3.json, champions_a3.json

На ВАЛИДАЦИИ (seed 777, 32 сценария): лучшее правило (7), «инвестируй, если окупается» (IIP, C++ invest_eval),
библиотека структурных политик (сетка эвристик × {без покупки, кандидат 0/1/2 в неделю 0}) → H* по баллу s.
На HOLDOUT (seed 2026102201, первые 100, стресс base; обучение их не видит): best_rule, IIP, H*, вся библиотека →
ex-post оракул (максимум прибыли по библиотеке на КАЖДОМ сценарии — недостижимая граница). Сравнения — по
экземплярам, в % стоимости портфеля V, IQM + бутстреп-ДИ + Уилкоксон.
"""
from __future__ import annotations

import argparse
import json
import time
from concurrent.futures import ProcessPoolExecutor

import numpy as np

from rl.eval.a3_common import (A3_RES, N_VALID, a3_names, best_rule, compare, iip_decide, library, load_a3, metrics,
                               run_policy, save, scen, score, value_of)
from rl.eval.struct_policies import Heuristic


def _instance(args) -> tuple[str, dict]:
    name, n_hold = args
    t0 = time.time()
    inst, v = load_a3(name), value_of(name)
    rule, rule_ms = best_rule(inst, v)
    sv, bv = scen("valid", N_VALID)
    iv = list(range(N_VALID))
    iip = iip_decide(inst, rule, sv, bv, iv)
    lib = library()
    base_m = rule_ms[rule]
    val = {h.name: metrics(run_policy(inst, h, sv, bv, iv, rule)) for h in lib}
    sc_v = {k: score(m, base_m, v) for k, m in val.items()}
    h_star = max(sc_v, key=sc_v.get)
    iip_name = "noop" if iip["pick"] < 0 else f"noop+inv{iip['pick']}"
    champ_pool = {"best_rule": 0.0, "IIP": sc_v[iip_name], "H*": sc_v[h_star]}
    champion = max(champ_pool, key=champ_pool.get)
    # Holdout: вся библиотека (для оракула) + best_rule/IIP/H* как её члены.
    sh, bh = scen("hold", n_hold)
    ih = list(range(n_hold))
    rows = {h.name: run_policy(inst, h, sh, bh, ih, rule) for h in lib}
    P = np.stack([[r["profit"] for r in rows[h.name]] for h in lib])           # [политика × сценарий]
    C = np.stack([[r["min_cash"] for r in rows[h.name]] for h in lib])
    best_k = P.argmax(0)
    oracle_rows = [{"profit": float(P[k, i]), "min_cash": float(C[k, i]), "min_liquidity": rows[lib[k].name][i].get("min_liquidity", 0.0),
                    "breach": rows[lib[k].name][i]["breach"], "otd": rows[lib[k].name][i]["otd"],
                    "tardiness_h": rows[lib[k].name][i]["tardiness_h"], "n_moves": rows[lib[k].name][i]["n_moves"]}
                   for i, k in enumerate(best_k)]
    hold = {"best_rule": metrics(rows["noop"]), "IIP": metrics(rows[iip_name]), "H*": metrics(rows[h_star]),
            "oracle_bound": metrics(oracle_rows), "_V": v}
    hold["champion"] = hold[champion]
    oracle_use = {lib[k].name: int(c) for k, c in zip(*np.unique(best_k, return_counts=True))}
    out = {"rule": rule, "rule_val": rule_ms, "iip": iip, "h_star": h_star, "val_scores": sc_v, "champion": champion,
           "champion_policy": {"best_rule": "noop", "IIP": iip_name, "H*": h_star}[champion], "holdout": hold,
           "oracle_use": oracle_use, "sec": time.time() - t0, "V": v}
    print(f"{name}: правило {rule}, IIP {iip['pick']}, H* {h_star} (s={sc_v[h_star]:+.4f}), чемпион {champion} "
          f"[{out['sec']:.0f} с]", flush=True)
    return name, out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=100)
    ap.add_argument("--workers", type=int, default=9)
    ap.add_argument("--only", nargs="*")
    a = ap.parse_args()
    t0 = time.time()
    names = a.only or a3_names()
    with ProcessPoolExecutor(a.workers) as ex:
        res = dict(ex.map(_instance, [(n, a.n) for n in names]))
    per = {n: res[n]["holdout"] for n in names}
    tab = {"H*_vs_best_rule": compare(per, names, "H*", "best_rule"),
           "IIP_vs_best_rule": compare(per, names, "IIP", "best_rule"),
           "champion_vs_best_rule": compare(per, names, "champion", "best_rule"),
           "oracle_vs_H*": compare(per, names, "oracle_bound", "H*"),
           "oracle_vs_champion": compare(per, names, "oracle_bound", "champion"),
           "oracle_vs_best_rule": compare(per, names, "oracle_bound", "best_rule")}
    for k, t in tab.items():
        d, c = t["d_cvar_profit"], t["d_cvar_cash"]
        print(f"{k:24s} ΔCVaR(Π) IQM {d['iqm']:+.3f}% V [{d['ci95'][0]:+.3f}; {d['ci95'][1]:+.3f}] p={d['wilcoxon_p']:.3g} "
              f"доля {d['win_share']:.2f} | ΔCVaR(Cmin) {c['iqm']:+.3f}% | ΔE {t['d_mean_profit']['iqm']:+.3f}%", flush=True)
    champs = {n: {k: res[n][k] for k in ("rule", "h_star", "champion", "champion_policy", "V")} | {"iip_pick": res[n]["iip"]["pick"]}
              for n in names}
    save(A3_RES / "headroom_a3.json", {"n_holdout": a.n, "instances": res, "tables": tab, "sec": time.time() - t0})
    save(A3_RES / "champions_a3.json", champs)


if __name__ == "__main__":
    main()
