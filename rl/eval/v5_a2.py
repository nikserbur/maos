"""V5 (A2): L0 «выбор правила» (BC и BC+PPO) против лучшего правила, статического чемпиона, ГА, CP-SAT и
ручного оракула на ОТЛОЖЕННЫХ сценариях — протокол §10.2а без изменений (holdout seed 2026102201, N на
экземпляр, CRN, IQM + парный бутстреп по экземплярам, Уилкоксон, гейт §7.4) + стресс «шок» с метриками
экстренного реагирования (двойники «без шока»).

    rl/.venv/bin/python -m rl.eval.v5_a2 --n 200 --seeds 1 2 3       # → rl/results/v5_a2.json, champion_a2.json

Статические базовые линии считаются ДО исполнения и только воспроизводятся (правило, ключ ГА, ключ CP-SAT);
события сценария (поломки, хвосты, срочные заказы, срывы поставок, кризис) раскрываются по ходу — их видит
только реактивная политика. Лучшее правило и чемпион выбраны на валидации (seed 777), не на holdout.
"""
from __future__ import annotations

import argparse
import json
import time
from concurrent.futures import ProcessPoolExecutor

import numpy as np

from rl.env.scenarios import HOLDOUT_SEED, STRESSES, ScenarioSet
from rl.eval.reactive import action_usage, emergency, eval_rows, load_cp_keys, oracle, rs_policy
from rl.eval.v5 import compare, ga_key
from rl.train.common import CKPT, RESULTS, episode_metrics, load_instances, maos_instance_names

STRESS_LIST = ["base", "crisis", "quantile", "joint", "shock"]
# Варианты обучения (A2): плотная награда на каждом событии; парная (CRN) награда к чемпиону с CVaR-весом.
VARIANTS = [("l0rule", "L0rule"), ("l0rule_p0", "L0rule_p0")]
ORACLE = "rush_expedite"


def _policies(name: str, ch: dict, cp_keys: dict, ga: dict, seeds: list[int]) -> dict:
    from sb3_contrib import MaskablePPO
    c = ch[name]
    specs = {"best_rule": ("static", c["best_rule_a"]), "champion": ("static", c["champion_a"]), "GA": ("key", ga[name]),
             "oracle": ("rs", rs_policy(ch, cp_keys, fn=oracle(ORACLE)))}
    if cp_keys.get(name):
        specs["CPSAT"] = ("key", cp_keys[name])
    # RL: по протоколу — лучший по ВАЛИДАЦИИ чекпойнт каждого варианта (кандидат гейта); для прозрачности —
    # BC (сид 1) и финальные PPO-чекпойнты (ранняя остановка их отвергла) как отрицательный контроль.
    for tag, label in VARIANTS:
        for s in seeds:
            meta = RESULTS / f"train_{tag}_seed{s}.json"
            dh = json.loads(meta.read_text(encoding="utf-8")).get("delta_h", 0.0) if meta.exists() else 0.0
            for suffix, lab in (("best", label), ("last", f"{label}_last")):
                if suffix == "last" and s != seeds[0]:
                    continue                                   # отрицательный контроль — один сид
                p = CKPT / f"{tag}_seed{s}_{suffix}.zip"
                if p.exists():
                    specs[f"{lab}_seed{s}"] = ("rs", rs_policy(ch, cp_keys, model=MaskablePPO.load(p, device="cpu"), delta_h=dh))
    p = CKPT / "l0rule_seed1_bc.zip"
    if p.exists():
        specs["L0rule_bc_seed1"] = ("rs", rs_policy(ch, cp_keys, model=MaskablePPO.load(p, device="cpu")))
    return specs


def _work(args):
    name, stress, n, ch, cp_keys, ga, seeds = args
    import torch
    torch.set_num_threads(1)
    inst = load_instances([name])[0]
    sc = ScenarioSet(n, HOLDOUT_SEED, stress=STRESSES[stress])
    idx = list(range(n))
    specs = _policies(name, ch, cp_keys, ga, seeds)
    rows = {k: eval_rows(inst, s, sc, idx, 50_000, cp_keys.get(name)) for k, s in specs.items()}
    usage = {k: action_usage(s[1]).get(name, {}) for k, s in specs.items() if s[0] == "rs"}
    twin = {}
    if stress == "shock":
        twin = {k: eval_rows(inst, s, sc, idx, 50_000, cp_keys.get(name), twin=True) for k, s in specs.items()}
    slim = lambda rr: [{"profit": r["profit"], "min_cash": r["min_cash"], "tardiness_h": r["tardiness_h"], "shock": r["shock"]} for r in rr]  # noqa: E731
    return name, stress, {k: episode_metrics(v) for k, v in rows.items()}, \
        ({k: slim(v) for k, v in rows.items()}, {k: slim(v) for k, v in twin.items()}) if stress == "shock" else None, usage


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=200)
    ap.add_argument("--seeds", type=int, nargs="+", default=[1, 2, 3])
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--stresses", type=str, nargs="+", default=STRESS_LIST)
    a = ap.parse_args()
    t0 = time.time()
    names = maos_instance_names(); insts = load_instances(names)
    cp_keys = load_cp_keys()
    ch = json.loads((RESULTS / "l0rule_champions.json").read_text(encoding="utf-8"))
    from rl.env.core import load_module
    me = load_module()
    gpath = RESULTS / "v5_a2_ga_keys.json"
    if gpath.exists():
        ga = json.loads(gpath.read_text(encoding="utf-8"))
    else:
        ga = {n: ga_key(me, inst) for n, inst in zip(names, insts)}
        gpath.write_text(json.dumps(ga), encoding="utf-8")
    print(f"ГА готов [{time.time() - t0:.0f}s]", flush=True)
    jobs = [(n, st, a.n, ch, cp_keys, ga, a.seeds) for st in a.stresses for n in names]
    out: dict = {"n": a.n, "holdout_seed": HOLDOUT_SEED, "seeds": a.seeds, "champions": ch, "oracle": ORACLE, "tables": {}}
    with ProcessPoolExecutor(a.workers) as ex:
        parts = list(ex.map(_work, jobs))
    for st in a.stresses:
        res = {}; usage = {}; shock_rows = {}; shock_twin = {}
        for name, s2, met, sh, us in parts:
            if s2 != st:
                continue
            for k, v in met.items():
                res.setdefault(k, {})[name] = v
            usage[name] = us
            if sh:
                for k, v in sh[0].items():
                    shock_rows.setdefault(k, {})[name] = v
                for k, v in sh[1].items():
                    shock_twin.setdefault(k, {})[name] = v
        pols = [k for k in res if all(n in res[k] for n in names)]
        comps = {}
        for cand in pols:
            if cand == "best_rule":
                continue
            comps[cand] = {f"vs_{b}": compare(res, names, cand, b) for b in ("best_rule", "champion", "GA", "CPSAT", "oracle")
                           if b in pols and b != cand}
        tab = {"metrics": res, "comparisons": comps, "action_usage": usage}
        if st == "shock":
            tab["emergency"] = {cand: emergency(shock_rows, shock_twin, names, cand, "best_rule") for cand in pols if cand != "best_rule"}
        out["tables"][st] = tab
        print(f"[{st}]", flush=True)
        for cand, c in comps.items():
            d = c["vs_best_rule"]["d_cvar_profit"]
            print(f"  {cand:18s} ΔCVaR(Π) IQM {d['iqm']:+.5f} ДИ [{d['ci95'][0]:+.5f}; {d['ci95'][1]:+.5f}] p={d['wilcoxon_p']:.3f} "
                  f"ΔCVaR(C) {c['vs_best_rule']['d_cvar_cash']['iqm']:+.5f} gate={c['vs_best_rule']['gate_pass']}", flush=True)
    # Гейт §7.4 (не ослаблен): чемпион = лучшая RL-политика с гейтом на БАЗОВЫХ holdout против лучшего правила.
    champ = {"policy": "best_rule", "score": 0.0, "note": "ни одна политика RL не прошла гейт"}
    if "base" in out["tables"]:
        for cand, c in out["tables"]["base"]["comparisons"].items():
            if not (cand.startswith("L0rule_seed") or cand.startswith("L0rule_p0_seed")):   # кандидаты гейта — лучшие по валидации
                continue
            cc = c["vs_best_rule"]
            if cc["gate_pass"] and cc["d_cvar_profit"]["iqm"] > champ["score"]:
                champ = {"policy": cand, "score": cc["d_cvar_profit"]["iqm"], "ci95": cc["d_cvar_profit"]["ci95"],
                         "wilcoxon_p": cc["d_cvar_profit"]["wilcoxon_p"], "d_cvar_cash_iqm": cc["d_cvar_cash"]["iqm"],
                         "vs_champion": c.get("vs_champion", {}).get("d_cvar_profit"), "holdout_seed": HOLDOUT_SEED, "n": a.n}
    out["champion"] = champ
    out["sec"] = time.time() - t0
    (RESULTS / "champion_a2.json").write_text(json.dumps(champ, indent=1, ensure_ascii=False), encoding="utf-8")
    (RESULTS / "v5_a2.json").write_text(json.dumps(out, indent=1, ensure_ascii=False), encoding="utf-8")
    print("чемпион:", champ, f"[{time.time() - t0:.0f}s]", flush=True)


if __name__ == "__main__":
    main()
