"""V5-A3 на предрегистрированном holdout (rl/eval/prereg_a3.md §3–§6): структурный RL против best_rule, CP-SAT, ГА с
тёплым стартом, «инвестируй, если окупается», лучшей эвристики H* и чемпиона; стрессы base / crisis / quantile /
joint / shock (+ CRN-двойники для метрик экстренного реагирования); гейты G1 и G2.

    rl/.venv/bin/python -m rl.eval.v5_a3 --n 200 --seeds 1 2 3 --workers 9   # → rl/results/a3/v5_a3.json, champion_a3.json

Политики RL — лучшие по ВАЛИДАЦИИ чекпойнты сидов (l3_seed*_best.zip); BC (сид 1) и финальный PPO (сид 1) —
контроль. Чемпион — лучшая неучащаяся политика по баллу валидации (best_rule, CPSAT, GA, IIP, H*).
"""
from __future__ import annotations

import argparse
import json
import time
from concurrent.futures import ProcessPoolExecutor

import numpy as np

from rl.eval.a3_common import (A3_RES, N_VALID, a3_names, compare, load_a3, metrics, run_policy, save, scen, score,
                               value_of)
from rl.eval.reactive import emergency
from rl.env.l3_env import run_struct
from rl.eval.struct_policies import Heuristic, with_sweep
from rl.train.common import CKPT

STRESS_LIST = ["base", "crisis", "quantile", "joint", "shock"]


def _rl_policy(path: str, h_star: str):
    import torch
    from sb3_contrib import MaskablePPO
    from rl.env.l3_env import rl_policy
    from rl.train.train_l3 import teacher
    torch.set_num_threads(1)
    return rl_policy(MaskablePPO.load(path, device="cpu"), teacher(h_star))


def _specs(name: str, ch: dict, keys: dict, seeds: list[int]) -> dict:
    """имя → (политика | None, (правило, ключ))."""
    from rl.train.train_l3 import heuristic
    c = ch[name]
    rule = c["rule"]
    k = keys.get(name, {})
    specs = {"best_rule": (None, (rule, [])), "H*": (None if c["h_star"] == "noop" else heuristic(c["h_star"]), (rule, [])),
             "IIP": (None if c["iip_pick"] < 0 else Heuristic(f"invest{c['iip_pick']}", invest=(c["iip_pick"],)), (rule, []))}
    specs["H*+sweep"] = (with_sweep(specs["H*"][0]), (rule, []))      # пост-хок контроль: H* + погашение линии излишком
    if k.get("key"):
        specs["CPSAT"] = (None, (rule, k["key"]))
    if k.get("ga_key"):
        specs["GA"] = (None, (rule, k["ga_key"]))
    for s in seeds:
        p = CKPT / f"l3_seed{s}_best.zip"
        if p.exists():
            specs[f"RL_seed{s}"] = (_rl_policy(str(p), c["h_star"]), (rule, []))
    for lab, suf in (("RL_bc_seed", "bc"), ("RL_last_seed", "last")):
        p = CKPT / f"l3_seed{seeds[0]}_{suf}.zip"
        if p.exists():
            specs[f"{lab}{seeds[0]}"] = (_rl_policy(str(p), c["h_star"]), (rule, []))
    # Вариант B (после диагноза A: PPO выучил только погашение линии): учитель и база — H* + погашение.
    for s in seeds:
        p = CKPT / f"l3s_seed{s}_best.zip"
        if p.exists():
            specs[f"RLB_seed{s}"] = (_rl_policy(str(p), c["h_star"] + "+sweep"), (rule, []))
    p = CKPT / f"l3s_seed{seeds[0]}_last.zip"
    if p.exists():
        specs[f"RLB_last_seed{seeds[0]}"] = (_rl_policy(str(p), c["h_star"] + "+sweep"), (rule, []))
    return specs


def _usage(rows: list[dict], sc) -> dict:
    """Интерпретация: ходы по видам, по типу эпохи (неделя/шок) и по режиму HMM сценария."""
    kinds: dict = {}
    by_trig: dict = {}
    by_reg: dict = {}
    for i, r in enumerate(rows):
        reg = str(sc.regime_of(i))
        for mv in r.get("moves", []):
            kd = mv["kind"]
            kinds[kd] = kinds.get(kd, 0) + 1
            tr = mv.get("before", {}).get("trigger", "week")
            by_trig.setdefault(tr, {}); by_trig[tr][kd] = by_trig[tr].get(kd, 0) + 1
            by_reg.setdefault(reg, {}); by_reg[reg][kd] = by_reg[reg].get(kd, 0) + 1
    n = max(1, len(rows))
    return {"per_episode": {k: v / n for k, v in kinds.items()}, "by_trigger": by_trig, "by_regime": by_reg,
            "examples": [mv for r in rows[:3] for mv in r.get("moves", [])[:6]]}


def _work(args):
    name, stress, n, ch, keys, seeds = args
    t0 = time.time()
    inst, v = load_a3(name), value_of(name)
    specs = _specs(name, ch, keys, seeds)
    sc, base = scen("hold", n, stress)
    idx = list(range(n))
    out = {"_V": v}
    rows_keep = {}
    for k, (pol, disp) in specs.items():
        rows = run_struct(inst, pol, sc, idx, base, dispatch=disp)
        out[k] = metrics(rows)
        rows_keep[k] = rows
        if k.startswith("RL_seed") or k == "H*":
            out[k]["usage"] = _usage(rows, sc)
    twin = {}
    if stress == "shock":
        for k, (pol, disp) in specs.items():
            twin[k] = run_struct(inst, pol, sc, idx, base, dispatch=disp, twin=True)
    slim = {k: [{"profit": r["profit"], "min_cash": r["min_cash"], "tardiness_h": r["tardiness_h"], "shock": r["shock"]} for r in rows]
            for k, rows in rows_keep.items()}
    slim_t = {k: [{"profit": r["profit"], "min_cash": r["min_cash"], "tardiness_h": r["tardiness_h"], "shock": r["shock"]} for r in rows]
              for k, rows in twin.items()}
    print(f"{name} [{stress}] {time.time() - t0:.0f} с", flush=True)
    return name, stress, out, slim, slim_t


def _val_one(args):
    """Валидация CPSAT/GA (для выбора чемпиона; остальные — из headroom)."""
    name, ch, keys = args
    inst = load_a3(name)
    sv, bv = scen("valid", N_VALID)
    out = {}
    for lab, key in (("CPSAT", keys.get(name, {}).get("key")), ("GA", keys.get(name, {}).get("ga_key"))):
        if key:
            out[lab] = metrics(run_policy(inst, Heuristic("noop"), sv, bv, list(range(N_VALID)), ch[name]["rule"], key=key))
    from rl.train.train_l3 import teacher
    out["H*+sweep"] = metrics(run_policy(inst, with_sweep(teacher(ch[name]["h_star"])), sv, bv, list(range(N_VALID)), ch[name]["rule"]))
    return name, out


def champions_full(names: list[str], ch: dict, keys: dict, hr: dict, workers: int) -> dict:
    with ProcessPoolExecutor(workers) as ex:
        val = dict(ex.map(_val_one, [(n, ch, keys) for n in names]))
    out = {}
    for n in names:
        inst = hr["instances"][n]
        base_m, V = inst["rule_val"][inst["rule"]], inst["V"]
        pool = {"best_rule": 0.0, "H*": inst["val_scores"][inst["h_star"]],
                "IIP": inst["val_scores"]["noop" if inst["iip"]["pick"] < 0 else f"noop+inv{inst['iip']['pick']}"]}
        for lab, m in val[n].items():
            pool[lab] = score(m, base_m, V)
        pre = {k: v for k, v in pool.items() if k != "H*+sweep"}          # предрегистрированный пул (§4 п.6)
        out[n] = {"pool": pool, "champion": max(pre, key=pre.get), "champion_plus": max(pool, key=pool.get)}
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=200)
    ap.add_argument("--seeds", type=int, nargs="+", default=[1, 2, 3])
    ap.add_argument("--workers", type=int, default=9)
    ap.add_argument("--stresses", nargs="+", default=STRESS_LIST)
    a = ap.parse_args()
    t0 = time.time()
    names = a3_names()
    ch = json.loads((A3_RES / "champions_a3.json").read_text(encoding="utf-8"))
    hr = json.loads((A3_RES / "headroom_a3.json").read_text(encoding="utf-8"))
    kp = A3_RES / "keys_a3.json"
    keys = json.loads(kp.read_text(encoding="utf-8")) if kp.exists() else {}
    champ = champions_full(names, ch, keys, hr, a.workers)
    tasks = [(n, s, a.n, ch, keys, a.seeds) for s in a.stresses for n in names]
    res: dict = {s: {} for s in a.stresses}
    rows: dict = {s: {} for s in a.stresses}
    twins: dict = {}
    with ProcessPoolExecutor(a.workers) as ex:
        for n, s, out, slim, slim_t in ex.map(_work, tasks):
            out["champion"] = out[champ[n]["champion"]]
            out["champion+"] = out[champ[n]["champion_plus"]]      # пост-хок: пул + «H* + подметание кассы»
            res[s][n] = out
            rows[s][n] = slim
            if slim_t:
                twins[n] = slim_t
    # Кандидат гейта — сид с лучшим баллом валидации (train_l3_seed*.json); сравнения по стрессам.
    tr = {s: json.loads((A3_RES / f"train_l3_seed{s}.json").read_text(encoding="utf-8")) for s in a.seeds
          if (A3_RES / f"train_l3_seed{s}.json").exists()}
    cand = max(tr, key=lambda s: tr[s]["best"]["score"]) if tr else None
    tables: dict = {}
    for s in a.stresses:
        pols = [k for k in res[s][names[0]] if not k.startswith("_")]
        tables[s] = {}
        for p in pols:
            if p in ("best_rule", "champion", "champion+"):
                continue
            tables[s][p] = {"vs_best_rule": compare(res[s], names, p, "best_rule"), "vs_champion": compare(res[s], names, p, "champion"),
                            "vs_champion+": compare(res[s], names, p, "champion+")}
            if "H*" in pols and p != "H*":
                tables[s][p]["vs_H*"] = compare(res[s], names, p, "H*")
    emerg = {}
    if "shock" in a.stresses and twins:
        R = {k: {n: rows["shock"][n][k] for n in names} for k in rows["shock"][names[0]]}
        T = {k: {n: twins[n][k] for n in names} for k in twins[names[0]]}
        emerg = {k: emergency(R, T, names, k, "best_rule") for k in R if k != "best_rule"}
    gate = {"candidate_seed": cand, "G1": None, "G2": None}
    if cand is not None and f"RL_seed{cand}" in tables.get("base", {}):
        b = tables["base"]
        g1 = b[f"RL_seed{cand}"]["vs_best_rule"]; g2 = b[f"RL_seed{cand}"]["vs_champion"]
        all_pos1 = all(b[f"RL_seed{s}"]["vs_best_rule"]["d_cvar_profit"]["iqm"] > 0 for s in tr if f"RL_seed{s}" in b)
        all_pos2 = all(b[f"RL_seed{s}"]["vs_champion"]["d_cvar_profit"]["iqm"] > 0 for s in tr if f"RL_seed{s}" in b)
        gate["G1"] = bool(g1["gate_pass"] and all_pos1)
        gate["G2"] = bool(g2["gate_pass"] and all_pos2)
        g3 = b[f"RL_seed{cand}"]["vs_champion+"]
        all_pos3 = all(b[f"RL_seed{s}"]["vs_champion+"]["d_cvar_profit"]["iqm"] > 0 for s in tr if f"RL_seed{s}" in b)
        gate["G2plus_posthoc"] = bool(g3["gate_pass"] and all_pos3)
    # Вариант B: кандидат — сид l3s с лучшим баллом валидации; гейт — к champion+ (строже предрегистрированного).
    trb = {s: json.loads((A3_RES / f"train_l3s_seed{s}.json").read_text(encoding="utf-8")) for s in a.seeds
           if (A3_RES / f"train_l3s_seed{s}.json").exists()}
    candb = max(trb, key=lambda s: trb[s]["best"]["score"]) if trb else None
    gate["candidate_seed_B"] = candb
    if candb is not None and f"RLB_seed{candb}" in tables.get("base", {}):
        b = tables["base"]
        for lab, key in (("B_G1", "vs_best_rule"), ("B_G2", "vs_champion"), ("B_G2plus", "vs_champion+")):
            allp = all(b[f"RLB_seed{s}"][key]["d_cvar_profit"]["iqm"] > 0 for s in trb if f"RLB_seed{s}" in b)
            gate[lab] = bool(b[f"RLB_seed{candb}"][key]["gate_pass"] and allp)
    out = {"n": a.n, "seeds": a.seeds, "stresses": a.stresses, "champions": champ, "per_instance": res, "tables": tables,
           "emergency": emerg, "gate": gate, "sec": time.time() - t0}
    save(A3_RES / "v5_a3.json", out)
    # gate_pass (API) — строгий: RL проходит, только если выигрыш не сводится к погашению линии (champion+).
    passA = bool(gate.get("G2") and gate.get("G2plus_posthoc"))
    passB = bool(gate.get("B_G2plus"))
    win = "B" if passB else ("A" if passA else None)
    save(A3_RES / "champion_a3.json", {"gate_pass": passA or passB, "gate_g1": bool(gate.get("G1") or gate.get("B_G1")),
                                       "gate_g2_prereg": bool(gate.get("G2")), "variant": win, "gate": gate,
                                       "candidate_seed": candb if win == "B" else cand,
                                       "champion_by_instance": {n: champ[n]["champion"] for n in names},
                                       "base": (tables.get("base", {}).get(f"RLB_seed{candb}") if win == "B" and candb
                                                else tables.get("base", {}).get(f"RL_seed{cand}") if cand else None)})
    print("гейт:", gate, f"[{time.time() - t0:.0f} с]", flush=True)


if __name__ == "__main__":
    main()
