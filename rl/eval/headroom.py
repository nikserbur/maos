"""Запас для реактивного управления (A2): могут ли ручные оракулы обыграть лучшее статическое правило?

    rl/.venv/bin/python -m rl.eval.headroom --n-val 24 --n 100      # → rl/results/a2_headroom.json

Протокол: статический чемпион и лучшее правило — по ВАЛИДАЦИИ (seed 777, смесь «половина с шоком»);
оракул выбирается по валидации; сравнение — на ОТЛОЖЕННЫХ сценариях (seed 2026102201, CRN) в двух
наборах: base (без шоков) и shock (≥ 1 экстренное событие в каждом). Если ни один оракул не обыгрывает
лучшее правило на holdout, у экземпляров нет запаса и обучать RL бессмысленно (требование владельца A2).
"""
from __future__ import annotations

import argparse
import json
import time
from concurrent.futures import ProcessPoolExecutor

import numpy as np

from rl.env.scenarios import HOLDOUT_SEED, STRESSES, ScenarioSet
from rl.eval.reactive import (ORACLES, compare_rows, emergency, eval_rows, load_cp_keys, oracle, rs_policy,
                              static_champions)
from rl.train.common import RESULTS, load_instances, maos_instance_names

VALID_SEED = 777


def _val_instance(args):
    name, n_val, champs, cp_keys = args
    inst = load_instances([name])[0]
    val = ScenarioSet(n_val, VALID_SEED, stress=STRESSES["base"])
    idx = list(range(n_val))
    out = {"champion": eval_rows(inst, ("static", champs[name]["champion_a"]), val, idx, 10_000, cp_keys.get(name))}
    for o in ORACLES:
        out[o] = eval_rows(inst, ("rs", rs_policy(champs, cp_keys, fn=oracle(o))), val, idx, 10_000)
    return name, out


def _hold_instance(args):
    name, n, champs, cp_keys, best_oracle, stress = args
    inst = load_instances([name])[0]
    sc = ScenarioSet(n, HOLDOUT_SEED, stress=STRESSES[stress])
    idx = list(range(n))
    specs = {"best_rule": ("static", champs[name]["best_rule_a"]), "champion": ("static", champs[name]["champion_a"]),
             "oracle": ("rs", rs_policy(champs, cp_keys, fn=oracle(best_oracle)))}
    res = {k: eval_rows(inst, s, sc, idx, 50_000, cp_keys.get(name)) for k, s in specs.items()}
    twin = {k: eval_rows(inst, s, sc, idx, 50_000, cp_keys.get(name), twin=True) for k, s in specs.items()} if stress == "shock" else {}
    return name, res, twin


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n-val", type=int, default=24)
    ap.add_argument("--n", type=int, default=100)
    ap.add_argument("--workers", type=int, default=6)
    a = ap.parse_args()
    t0 = time.time()
    names = maos_instance_names()
    cp_keys = load_cp_keys()
    val = ScenarioSet(a.n_val, VALID_SEED, stress=STRESSES["base"])
    with ProcessPoolExecutor(a.workers) as ex:
        champs = {}
        for part in ex.map(_champ_one, [(n, a.n_val, cp_keys) for n in names]):
            champs.update(part)
        print("чемпионы:", {n: (c["best_rule"], c["champion"]) for n, c in champs.items()}, f"[{time.time() - t0:.0f}s]", flush=True)
        vres = dict(ex.map(_val_instance, [(n, a.n_val, champs, cp_keys) for n in names]))
        scores = {}
        for o in ORACLES:
            res = {"o": {n: vres[n][o] for n in names}, "c": {n: vres[n]["champion"] for n in names}}
            scores[o] = compare_rows(res, names, "o", "c")["d_cvar_profit"]["mean"]
        best = max(scores, key=scores.get)
        print("валидация оракулов (средн. ΔCVaR к чемпиону):", {k: round(v, 5) for k, v in scores.items()}, "→", best, flush=True)
        out = {"n_val": a.n_val, "n": a.n, "champions": champs, "oracle_val_scores": scores, "best_oracle": best, "holdout": {}}
        for stress in ("base", "shock"):
            parts = list(ex.map(_hold_instance, [(n, a.n, champs, cp_keys, best, stress) for n in names]))
            res = {k: {n: r[k] for n, r, _ in parts} for k in ("best_rule", "champion", "oracle")}
            tw = {k: {n: t[k] for n, _, t in parts} for k in ("best_rule", "champion", "oracle")} if stress == "shock" else None
            tab = {"oracle_vs_best_rule": compare_rows(res, names, "oracle", "best_rule"),
                   "oracle_vs_champion": compare_rows(res, names, "oracle", "champion"),
                   "champion_vs_best_rule": compare_rows(res, names, "champion", "best_rule")}
            if tw:
                tab["emergency_oracle_vs_best_rule"] = emergency(res, tw, names, "oracle", "best_rule")
            # Чувствительность денег к расписанию: разброс CVaR(Π) статиков (валидация), доли E[Π].
            out["holdout"][stress] = tab
            d = tab["oracle_vs_best_rule"]["d_cvar_profit"]
            print(f"[{stress}] оракул {best} против лучшего правила: IQM ΔCVaR {d['iqm']:+.5f} ДИ [{d['ci95'][0]:+.5f}; {d['ci95'][1]:+.5f}] "
                  f"p={d['wilcoxon_p']:.3f}  [{time.time() - t0:.0f}s]", flush=True)
    out["sec"] = time.time() - t0
    (RESULTS / "a2_headroom.json").write_text(json.dumps(out, indent=1, ensure_ascii=False), encoding="utf-8")


def _champ_one(args):
    name, n_val, cp_keys = args
    inst = load_instances([name])[0]
    val = ScenarioSet(n_val, VALID_SEED, stress=STRESSES["base"])
    return static_champions([name], [inst], val, n_val, cp_keys)


if __name__ == "__main__":
    main()
