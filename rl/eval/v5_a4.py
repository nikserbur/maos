"""V5-A4 на двух отложенных наборах (rl/eval/prereg_a4.md §3–§8): структурный RL против C* (главный гейт G-A4) и
строгого чемпиона C** (G-strict), плюс лучшее правило, CP-SAT, ГА с тёплым стартом, IIP, LA*; стрессы base / crisis /
quantile / joint / shock (+ CRN-двойники для экстренного реагирования); интерпретация ходов.

    rl/.venv/bin/python -m rl.eval.v5_a4 --n 200 --workers 9      # → rl/results/a4/v5_a4.json, champion_a4.json

Кандидат: вариант (A | B) с лучшим средним по сидам баллом валидации, в нём — сид с лучшим баллом (только
валидация A3; набор F и holdout при выборе не используются).
"""
from __future__ import annotations

import argparse
import json
import time
from concurrent.futures import ProcessPoolExecutor

import numpy as np

from rl.eval.a3_common import A3_RES, library
from rl.eval.a4_common import A4_RES, compare_sets, la_family, load4, metrics, run4, save, scen4, set_names, value_of
from rl.eval.reactive import emergency
from rl.train.common import CKPT

STRESS_LIST = ["base", "crisis", "quantile", "joint", "shock"]
VARIANTS = ("A", "B", "C", "D")


def _rl(path: str, spec: str):
    import torch
    from rl.train.train_l4 import ActorCritic, policy_fn
    torch.set_num_threads(1)
    net = ActorCritic(); net.load_state_dict(torch.load(path, map_location="cpu", weights_only=True)); net.eval()
    return policy_fn(net, spec, False, None)


def _keys(name: str) -> dict:
    p = (A3_RES / "keys_a3.json") if name.startswith("a3-") else (A4_RES / "keys_a4f.json")
    return json.loads(p.read_text(encoding="utf-8")).get(name, {}) if p.exists() else {}


def _specs(name: str, ch: dict, seeds: list[int], cand: dict, stress: str = "base") -> dict:
    """имя → (политика | None, ключ). Вне стресса base — из RL только кандидат (сиды и контроли — на base)."""
    lib = {h.name: h for h in library()}
    las = {h.name: h for h in la_family()}
    c = ch[name]

    def pol(nm):
        h = lib.get(nm) or las.get(nm)
        return None if (nm == "noop") else h
    specs = {"best_rule": (None, []), "C*": (pol(c["C*"]), []), "LA*": (pol(c["LA*"]), []),
             "IIP": (None if c["iip_pick"] < 0 else lib[f"noop+inv{c['iip_pick']}"], [])}
    if c.get("h_star_a3"):
        specs["H*_A3"] = (pol(c["h_star_a3"]), [])
    k = _keys(name)
    if k.get("key"):
        specs["CPSAT"] = (None, k["key"])
    if k.get("ga_key"):
        specs["GA"] = (None, k["ga_key"])
    for v in VARIANTS:
        for s in seeds:
            p = CKPT / f"l4{v}_seed{s}_best.pt"
            is_cand = cand.get("variant") == v and cand.get("seed") == s
            if p.exists() and (stress == "base" or is_cand):
                specs[f"RL{v}_seed{s}"] = (_rl(str(p), f"{c['C*']}|{c['LA*']}"), [])
    if cand.get("variant") and stress == "base":
        v, s = cand["variant"], cand["seed"]
        for lab, suf in (("RL_bc", "bc"), ("RL_last", "last")):
            p = CKPT / f"l4{v}_seed{s}_{suf}.pt"
            if p.exists():
                specs[lab] = (_rl(str(p), f"{c['C*']}|{c['LA*']}"), [])
        p = CKPT / "l4D_seed1_last.pt"                       # контроль П4: «лоза» D после 2.5·10⁶ решений (отклоняется от C*)
        if p.exists():
            specs["RLD_last"] = (_rl(str(p), f"{c['C*']}|{c['LA*']}"), [])
    if stress in ("base", "shock"):                          # RL → эвристики (В1): «C* + дерево», без нейросети
        from rl.eval.distill_a4 import load_distilled
        for kind in ("A3B", "A4D"):
            if (A4_RES / f"dist_{kind}.pkl").exists():
                specs[f"DIST_{kind}"] = (load_distilled(kind, c), [])
    return specs


def _dedupe(name: str, seeds: list[int]) -> dict:
    """Одинаковые веса (лучший чекпойнт = BC того же сида) — один прогон: метка → метка-оригинал."""
    import hashlib
    seen, alias = {}, {}
    for v in VARIANTS:
        for s in seeds:
            p = CKPT / f"l4{v}_seed{s}_best.pt"
            if p.exists():
                import torch
                sd = torch.load(p, map_location="cpu", weights_only=True)
                h = hashlib.sha256(b"".join(t.numpy().tobytes() for t in sd.values())).hexdigest()
                if h in seen:
                    alias[f"RL{v}_seed{s}"] = seen[h]
                else:
                    seen[h] = f"RL{v}_seed{s}"
    return alias


def _usage(rows: list[dict], sc) -> dict:
    kinds: dict = {}; by_trig: dict = {}; by_reg: dict = {}; by_week: dict = {}
    for i, r in enumerate(rows):
        reg = str(sc.regime_of(i))
        for mv in r.get("moves", []):
            kd = mv["kind"]
            kinds[kd] = kinds.get(kd, 0) + 1
            tr = mv.get("before", {}).get("trigger", "week")
            by_trig.setdefault(tr, {}); by_trig[tr][kd] = by_trig[tr].get(kd, 0) + 1
            by_reg.setdefault(reg, {}); by_reg[reg][kd] = by_reg[reg].get(kd, 0) + 1
            wk = str(mv.get("week", -1)); by_week.setdefault(wk, {}); by_week[wk][kd] = by_week[wk].get(kd, 0) + 1
    n = max(1, len(rows))
    return {"per_episode": {k: v / n for k, v in kinds.items()}, "by_trigger": by_trig, "by_regime": by_reg, "by_week": by_week,
            "examples": [mv for r in rows[:2] for mv in r.get("moves", [])[:8]]}


def _slim(rows: list[dict]) -> list[dict]:
    return [{"profit": r["profit"], "min_cash": r["min_cash"], "tardiness_h": r["tardiness_h"], "shock": r["shock"]} for r in rows]


def _work(args):
    name, stress, n, ch, seeds, cand = args
    t0 = time.time()
    inst, v = load4(name), value_of(name)
    rule = ch[name]["rule"]
    specs = _specs(name, ch, seeds, cand, stress)
    sc, base = scen4("hold", n, stress)
    idx = list(range(n))
    out = {"_V": v}
    slim, slim_t = {}, {}
    alias = _dedupe(name, seeds)
    for k, (pol, key) in specs.items():
        if k in alias and alias[k] in out:                # те же веса — те же эпизоды (детерминированно, CRN)
            out[k] = out[alias[k]]; slim[k] = slim[alias[k]]
            if alias[k] in slim_t:
                slim_t[k] = slim_t[alias[k]]
            continue
        rows = run4(inst, pol, sc, base, idx, rule, key=key)
        out[k] = metrics(rows)
        slim[k] = _slim(rows)
        if k.startswith("RL") or k in ("C*", "LA*"):
            out[k]["usage"] = _usage(rows, sc)
        if stress == "shock":
            slim_t[k] = _slim(run4(inst, pol, sc, base, idx, rule, key=key, twin=True))
    print(f"{name} [{stress}] {time.time() - t0:.0f} с", flush=True)
    return name, stress, out, slim, slim_t


def candidate() -> dict:
    """Поправка П3: вариант — по баллу валидации сида 1; кандидат — лучший по валидации сид этого варианта."""
    logs: dict = {}
    for v in VARIANTS:
        for p in sorted(A4_RES.glob(f"train_l4{v}_seed*.json")):
            lg = json.loads(p.read_text(encoding="utf-8"))
            logs.setdefault(v, {})[int(lg["seed"])] = float(lg["best"]["score"])
    first = {v: d[1] for v, d in logs.items() if 1 in d}
    if not first:
        return {}
    v = max(first, key=first.get)
    s = max(logs[v], key=logs[v].get)
    return {"variant": v, "seed": int(s), "validation": logs, "seeds": sorted(logs[v])}


def gate(tables: dict, cand: dict, seeds: list[int]) -> dict:
    """§8: G-A4(X) и G-strict(X) по стрессу base для X ∈ {A3, F}; все сиды кандидатного варианта IQM > 0."""
    out = {"candidate": cand}
    if not cand:
        return {**out, "gate_pass": False}
    lab = f"RL{cand['variant']}_seed{cand['seed']}"
    ok_all = True
    for X in ("A3", "F"):
        b = tables.get(X, {}).get("base", {})
        if lab not in b:
            out[X] = None; ok_all = False; continue
        res = {}
        for g, key in (("G-A4", "vs_C*"), ("G-strict", "vs_C**")):
            t = b[lab][key]
            seeds_ok = all(f"RL{cand['variant']}_seed{s}" in b and b[f"RL{cand['variant']}_seed{s}"][key]["d_cvar_profit"]["iqm"] > 0
                           for s in cand.get("seeds", seeds))
            res[g] = {"pass": bool(t["gate_pass"] and seeds_ok), "iqm": t["d_cvar_profit"]["iqm"], "ci95": t["d_cvar_profit"]["ci95"],
                      "p": t["d_cvar_profit"]["wilcoxon_p"], "cash_iqm": t["d_cvar_cash"]["iqm"], "all_seeds_positive": seeds_ok}
            ok_all &= res[g]["pass"]
        out[X] = res
    out["gate_pass"] = bool(ok_all)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=200)
    ap.add_argument("--seeds", type=int, nargs="+", default=[1, 2, 3])
    ap.add_argument("--workers", type=int, default=9)
    ap.add_argument("--stresses", nargs="+", default=STRESS_LIST)
    ap.add_argument("--sets", nargs="+", default=["A3", "F"])
    a = ap.parse_args()
    t0 = time.time()
    ch = json.loads((A4_RES / "champions_a4.json").read_text(encoding="utf-8"))
    cand = candidate()
    names = {X: set_names(X) for X in a.sets}
    st_of = {X: (a.stresses if X == "A3" else [s for s in a.stresses if s in ("base", "shock")]) for X in a.sets}   # П3
    tasks = [(n, s, a.n, ch, a.seeds, cand) for X in a.sets for s in st_of[X] for n in names[X]]
    tasks.sort(key=lambda t: {"l": 0, "m": 1, "s": 2}[t[0].split("-")[1][0]])
    res: dict = {X: {s: {} for s in st_of[X]} for X in a.sets}
    rows: dict = {X: {s: {} for s in st_of[X]} for X in a.sets}
    twins: dict = {X: {} for X in a.sets}
    setof = {n: X for X in a.sets for n in names[X]}
    with ProcessPoolExecutor(a.workers) as ex:
        for n, s, out, slim, slim_t in ex.map(_work, tasks):
            X = setof[n]
            out["C**"] = out.get(ch[n]["champion"], out["C*"])
            res[X][s][n] = out; rows[X][s][n] = slim
            if slim_t:
                twins[X][n] = slim_t
    tables: dict = {}
    emerg: dict = {}
    for X in a.sets:
        tables[X] = {}
        for s in st_of[X]:
            pols = [k for k in res[X][s][names[X][0]] if not k.startswith("_") and all(k in res[X][s][n] for n in names[X])]
            tables[X][s] = {}
            for p in pols:
                if p in ("best_rule", "C**"):
                    continue
                tables[X][s][p] = {"vs_best_rule": compare_sets(res[X][s], names[X], p, "best_rule"),
                                   "vs_C*": compare_sets(res[X][s], names[X], p, "C*"),
                                   "vs_C**": compare_sets(res[X][s], names[X], p, "C**")}
        if "shock" in a.stresses and twins[X]:
            R = {k: {n: rows[X]["shock"][n][k] for n in names[X]} for k in rows[X]["shock"][names[X][0]]}
            T = {k: {n: twins[X][n][k] for n in names[X]} for k in twins[X][names[X][0]]}
            emerg[X] = {k: emergency(R, T, names[X], k, "best_rule") for k in R if k != "best_rule"}
            if "C*" in R:
                emerg[X].update({f"{k}|vs_C*": emergency(R, T, names[X], k, "C*") for k in R if k.startswith("RL")})
    g = gate(tables, cand, a.seeds)
    out = {"n": a.n, "seeds": a.seeds, "stresses": a.stresses, "sets": a.sets, "candidate": cand, "per_instance": res,
           "tables": tables, "emergency": emerg, "gate": g, "sec": time.time() - t0}
    save(A4_RES / "v5_a4.json", out)
    lab = f"RL{cand['variant']}_seed{cand['seed']}" if cand else None
    save(A4_RES / "champion_a4.json", {"gate_pass": g["gate_pass"], "gate": g, "candidate": cand,
                                       "champion_by_instance": {n: ch[n]["champion"] for X in a.sets for n in names[X]},
                                       "base": {X: tables[X]["base"].get(lab) for X in a.sets} if lab else None})
    print("гейт:", json.dumps(g, ensure_ascii=False)[:2000], f"[{time.time() - t0:.0f} с]", flush=True)


if __name__ == "__main__":
    main()
