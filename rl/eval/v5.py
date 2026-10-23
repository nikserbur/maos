"""V5 — структурный RL против правил и ГА на ОТЛОЖЕННЫХ сценариях (§10.1, §10.2а), с гейтом §7.4.

    rl/.venv/bin/python -m rl.eval.v5 --n 200 --seeds 1 2 3

Протокол: holdout seed 2026102201 [НОРМ], N сценариев на экземпляр, одни и те же сценарии для всех
политик (CRN). Базовые линии: лучшее из 7 правил (выбрано на ВАЛИДАЦИОННЫХ сценариях, не на holdout),
ГА по ключам (обучен на сценариях seed 1000+, структура фиксирована). RL: L0 (сиды обучения), L2+EDD,
L2+L0. Метрики: IQM по экземплярам ΔCVaR_0.1(Π) (в долях E[Π] базовой линии), ΔCVaR_0.05(C_min),
ΔP(разрыв), ΔE[Cmax]; парный бутстреп-ДИ по экземплярам; Уилкоксон; доля эпизодов со структурными
ходами. Стрессы §10.2а п.5: кризисный режим с вероятностью 1, квантильный Student-t, совместный шок —
отдельные таблицы. Гейт: претендент заменяет чемпиона (rl/results/champion.json), только если ДИ
IQM-выигрыша по CVaR(Π) не содержит 0 и ΔCVaR(C_min) ≥ 0.
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np
from sb3_contrib import MaskablePPO

from rl.env.core import load_module, make_config
from rl.env.scenarios import STRESSES, ScenarioSet
from rl.train.common import (ALPHA_PROFIT, CKPT, RESULTS, RULES, EvalSpec, RuleSelectPolicy, cvar_lower, episode_metrics, iqm,
                             load_instances, maos_instance_names, paired_bootstrap_ci, run_episodes, sb3_policy, wilcoxon_p)
from rl.train.train_l0 import VALID_N_PER_INSTANCE

GA_TRAIN_SEED0, GA_NS, GA_GENS, GA_SEC = 1000, 8, 30, 30.0   # [К] rl.ga_baseline.*


def ga_key(me, inst) -> list[float]:
    env = me.SimEnv(inst, make_config({"breakdowns": True}))
    env.reset(GA_TRAIN_SEED0)
    return json.loads(me.ga_improve(env, GA_GENS, GA_NS, GA_TRAIN_SEED0, GA_SEC, RULES))["best_key"]


def best_rule_on_validation(inst, vs: ScenarioSet) -> str:
    """Лучшее правило по CVaR прибыли на валидационных сценариях (не holdout)."""
    best, bv = "EDD", -np.inf
    for r in RULES:
        rows = run_episodes(inst, f"rule:{r}", vs, list(range(vs.n)), 10_000, {"breakdowns": True})
        v = cvar_lower(np.array([x["profit"] for x in rows]), ALPHA_PROFIT)
        if v > bv:
            bv, best = v, r
    return best


def eval_policies(names, insts, scen: ScenarioSet, idx, seed_base, policies: dict, l2: dict) -> dict:
    """policies: имя → ('rule', r) | ('key', key_by_instance) | ('l0', fn); l2: имя → (l2_fn, inner_spec)."""
    out: dict = {}
    for pname, spec in policies.items():
        out[pname] = {}
        for n, inst in zip(names, insts):
            kind = spec[0]
            if kind == "rule":
                rows = run_episodes(inst, f"rule:{spec[1] if isinstance(spec[1], str) else spec[1][n]}", scen, idx, seed_base, {"breakdowns": True})
            elif kind == "key":
                rows = run_episodes(inst, "key", scen, idx, seed_base, {"breakdowns": True}, key=spec[1][n])
            else:
                rows = run_episodes(inst, spec[1], scen, idx, seed_base, {"breakdowns": True})
            out[pname][n] = episode_metrics(rows)
    for pname, (l2fn, inner) in l2.items():
        out[pname] = {}
        for n, inst in zip(names, insts):
            rows = run_episodes(inst, inner, scen, idx, seed_base, {"breakdowns": True, "l2_enabled": True}, l2_policy=l2fn, l0_inner=inner)
            out[pname][n] = episode_metrics(rows)
    return out


def compare(res: dict, names, cand: str, base: str) -> dict:
    """Парные разности по экземплярам: ΔCVaR(Π)/|E Π_base|, ΔCVaR(C_min)/|E Π_base|, ΔP(разрыв), ΔE[Cmax] (ч)."""
    d_prof, d_cash, d_breach, d_mk, d_tard = [], [], [], [], []
    for n in names:
        a, b = res[cand][n], res[base][n]
        s = max(1.0, abs(b["profit_mean"]))
        d_prof.append((a["profit_cvar"] - b["profit_cvar"]) / s)
        d_cash.append((a["cash_min_cvar"] - b["cash_min_cvar"]) / s)
        d_breach.append(a["p_breach"] - b["p_breach"])
        d_mk.append(a["makespan_mean_h"] - b["makespan_mean_h"])
        d_tard.append(a["tardiness_mean_h"] - b["tardiness_mean_h"])
    out = {}
    for k, d in (("d_cvar_profit", d_prof), ("d_cvar_cash", d_cash), ("d_p_breach", d_breach), ("d_makespan_h", d_mk), ("d_tardiness_h", d_tard)):
        m, lo, hi = paired_bootstrap_ci(np.array(d))
        out[k] = {"iqm": m, "ci95": [lo, hi], "mean": float(np.mean(d)), "wilcoxon_p": wilcoxon_p(np.array(d)), "n_instances": len(d),
                  "win_share": float(np.mean(np.array(d) > 0)) if k in ("d_cvar_profit", "d_cvar_cash") else float(np.mean(np.array(d) < 0))}
    out["gate_pass"] = bool(out["d_cvar_profit"]["ci95"][0] > 0 and out["d_cvar_cash"]["iqm"] >= 0)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=200)
    ap.add_argument("--seeds", type=int, nargs="+", default=[1, 2, 3])
    ap.add_argument("--weeks", type=int, default=26)
    ap.add_argument("--no-stress", action="store_true")
    ap.add_argument("--baselines-only", action="store_true")
    ap.add_argument("--stress", type=str, default="", help="только один стресс (base|crisis|quantile|joint) — параллельный запуск")
    ap.add_argument("--out", type=Path, default=RESULTS / "v5_results.json")
    # A2: отдельные кэш/чемпион по тегу (экземпляры обогащённой НСИ) и набор политик.
    ap.add_argument("--tag", type=str, default="", help="суффикс кэша базовых линий и champion (A2: _a2)")
    ap.add_argument("--families", type=str, nargs="+", default=["l0", "l2", "l0rule"], help="семейства политик RL")
    a = ap.parse_args()
    me = load_module()
    names = maos_instance_names(); insts = load_instances(names)
    spec = EvalSpec(n_holdout=a.n, weeks=a.weeks)
    t0 = time.time()
    vs = ScenarioSet(VALID_N_PER_INSTANCE, spec.valid_seed, weeks=a.weeks)
    cache = RESULTS / f"v5{a.tag}_baselines.json"   # лучшее правило (валидация) и ключи ГА — детерминированны, кэшируются
    if cache.exists():
        cj = json.loads(cache.read_text(encoding="utf-8")); best_rule, keys = cj["best_rule"], cj["keys"]
    else:
        best_rule = {n: best_rule_on_validation(inst, vs) for n, inst in zip(names, insts)}
        keys = {n: ga_key(me, inst) for n, inst in zip(names, insts)}
        cache.write_text(json.dumps({"best_rule": best_rule, "keys": keys}), encoding="utf-8")
    print("лучшее правило (валидация):", best_rule, flush=True)
    print(f"ГА готов [{time.time() - t0:.0f}s]", flush=True)
    if a.baselines_only:
        return
    policies: dict = {"best_rule": ("rule", best_rule), "EDD": ("rule", "EDD"), "GA": ("key", keys)}
    l0_models = {}
    for s in a.seeds:
        p = CKPT / f"l0_seed{s}_best.zip"
        if p.exists() and "l0" in a.families:
            l0_models[s] = MaskablePPO.load(p, device="cpu")
            policies[f"L0_seed{s}"] = ("l0", sb3_policy(l0_models[s]))
        p = CKPT / f"l0rule_seed{s}_best.zip"     # A2: L0 как выбор правила (Tang 2026)
        if p.exists() and "l0rule" in a.families:
            policies[f"L0rule_seed{s}"] = ("l0", RuleSelectPolicy(MaskablePPO.load(p, device="cpu")))
    l2: dict = {}
    for s in a.seeds if "l2" in a.families else []:
        for tag, inner in (("edd", "rule:EDD"), ("l0", None)):
            p = CKPT / f"l2_{tag}_seed{s}_best.zip"
            if not p.exists():
                continue
            if tag == "l0":
                if s not in l0_models:
                    continue
                inner = sb3_policy(l0_models[s])
            l2[f"L2_{tag}_seed{s}"] = (sb3_policy(MaskablePPO.load(p, device="cpu")), inner)
    idx = list(range(a.n))
    results: dict = {"n": a.n, "holdout_seed": spec.holdout_seed, "seeds": a.seeds, "best_rule": best_rule, "instances": names,
                     "policies": list(policies) + list(l2), "tables": {}}
    stress_list = [a.stress] if a.stress else (["base"] if a.no_stress else ["base", "crisis", "quantile", "joint"])
    for st in stress_list:
        scen = ScenarioSet(a.n, spec.holdout_seed, weeks=a.weeks, stress=STRESSES[st])
        res = eval_policies(names, insts, scen, idx, 50_000, policies, l2)
        comps = {}
        for cand in list(policies) + list(l2):
            if cand in ("best_rule", "EDD", "GA"):
                continue
            comps[cand] = {"vs_best_rule": compare(res, names, cand, "best_rule"), "vs_GA": compare(res, names, cand, "GA"),
                           "vs_EDD": compare(res, names, cand, "EDD")}
        comps["GA"] = {"vs_best_rule": compare(res, names, "GA", "best_rule")}
        results["tables"][st] = {"regime_share": scen.regime_share, "metrics": res, "comparisons": comps}
        print(f"[{st}] готово [{time.time() - t0:.0f}s]", flush=True)
        for cand, c in comps.items():
            for ref, cc in c.items():
                d = cc["d_cvar_profit"]
                print(f"  {cand:14s} {ref:13s} ΔCVaR(Π) IQM {d['iqm']:+.4f} ДИ [{d['ci95'][0]:+.4f}, {d['ci95'][1]:+.4f}] p={d['wilcoxon_p']:.3f} "
                      f"ΔCVaR(C) {cc['d_cvar_cash']['iqm']:+.4f} ΔP(разрыв) {cc['d_p_breach']['iqm']:+.3f} gate={cc['gate_pass']}", flush=True)
    if "base" not in results["tables"]:          # частичный (стрессовый) запуск — без гейта
        results["sec"] = time.time() - t0
        a.out.write_text(json.dumps(results, indent=1, ensure_ascii=False), encoding="utf-8")
        return
    # Гейт §7.4: чемпион = лучшая по ДИ политика RL на базовых holdout; иначе остаётся правило/ГА.
    base_comps = results["tables"]["base"]["comparisons"]
    champ_path = RESULTS / f"champion{a.tag}.json"
    champion = json.loads(champ_path.read_text(encoding="utf-8")) if champ_path.exists() else {"policy": "best_rule", "score": 0.0}
    for cand, c in base_comps.items():
        if cand == "GA":
            continue
        cc = c["vs_best_rule"]
        if cc["gate_pass"] and cc["d_cvar_profit"]["iqm"] > champion.get("score", 0.0):
            champion = {"policy": cand, "score": cc["d_cvar_profit"]["iqm"], "ci95": cc["d_cvar_profit"]["ci95"], "holdout_seed": spec.holdout_seed, "n": a.n}
    results["champion"] = champion
    champ_path.write_text(json.dumps(champion, indent=1, ensure_ascii=False), encoding="utf-8")
    results["sec"] = time.time() - t0
    a.out.write_text(json.dumps(results, indent=1, ensure_ascii=False), encoding="utf-8")
    print("чемпион:", champion, flush=True)


if __name__ == "__main__":
    main()
