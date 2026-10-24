"""Неучащиеся базы A4 и запас H0-A4 до обучения (rl/eval/prereg_a4.md §3–§4, §1).

    rl/.venv/bin/python -m rl.eval.baselines_a4 --set A3 --workers 9     # → rl/results/a4/base/<экз>.json
    rl/.venv/bin/python -m rl.eval.baselines_a4 --set F  --workers 9
    rl/.venv/bin/python -m rl.eval.baselines_a4 --aggregate              # → baselines_a4.json, champions_a4.json
    rl/.venv/bin/python -m rl.eval.baselines_a4 --shift --workers 9      # сдвиг эталонных чисел A3 (до/после A4)

На ВАЛИДАЦИИ (seed 777, 128 сц.): лучшее правило, таблица взгляда вперёд инвестиций, библиотека A3 (56) → C*,
LA(θ) → LA*, IIP, ключи CP-SAT/ГА → C**. На HOLDOUT (первые 100, base): библиотека ∪ LA → ex-post оракул
(диагностика H0-A4), C*, LA*, IIP, лучшее правило, H*_A3. Все прогоны — при погашении линии излишком кассы и налоге
нарастающим итогом (умолчания продукта A4).
"""
from __future__ import annotations

import argparse
import json
import time
from concurrent.futures import ProcessPoolExecutor

import numpy as np

from rl.env.l3_env import run_struct
from rl.eval.a3_common import A3_RES, iip_decide, library
from rl.eval.a4_common import (A4_RES, N_VALID4, compare_sets, invest_lookahead, la_family, load4, metrics, run4,
                               save, scen4, score, set_names, value_of)
from rl.eval.struct_policies import Heuristic, with_sweep
from rl.train.common import RULES

BASE_DIR = A4_RES / "base"


def _best_rule(inst, sv, bv, iv) -> tuple[str, dict]:
    ms = {r: metrics(run_struct(inst, None, sv, iv, bv, dispatch=(r, []))) for r in RULES}
    return max(RULES, key=lambda r: (ms[r]["profit_cvar"], ms[r]["profit_mean"])), ms


def _pol(h):
    return None if (isinstance(h, Heuristic) and h.name == "noop" and not h.invest) else h


def _keys(name: str) -> dict:
    p = (A3_RES / "keys_a3.json") if name.startswith("a3-") else (A4_RES / "keys_a4f.json")
    return json.loads(p.read_text(encoding="utf-8")).get(name, {}) if p.exists() else {}


def _h_star_a3(name: str):
    if not name.startswith("a3-"):
        return None
    ch = json.loads((A3_RES / "champions_a3.json").read_text(encoding="utf-8"))[name]
    return ch["h_star"]


def _instance(args) -> tuple[str, dict]:
    name, n_hold = args
    path = BASE_DIR / f"{name}.json"
    if path.exists():
        return name, json.loads(path.read_text(encoding="utf-8"))
    t0 = time.time()
    v = value_of(name)
    sv, bv = scen4("valid", N_VALID4)
    iv = list(range(N_VALID4))
    inst0 = load4(name, [])
    rule, rule_ms = _best_rule(inst0, sv, bv, iv)
    t_rule = time.time() - t0
    invest_lookahead(name, rule)
    t_la = time.time() - t0 - t_rule
    inst = load4(name)
    base_m = rule_ms[rule]
    lib = {h.name: h for h in library()}
    las = {h.name: h for h in la_family()}
    val = {k: metrics(run4(inst, _pol(h), sv, bv, iv, rule)) for k, h in {**lib, **las}.items()}
    sc_v = {k: score(m, base_m, v) for k, m in val.items()}
    c_star = max(lib, key=lambda k: sc_v[k])
    la_star = max(las, key=lambda k: sc_v[k])
    iip = iip_decide(inst, rule, sv, bv, iv)
    iip_name = "noop" if iip["pick"] < 0 else f"noop+inv{iip['pick']}"
    keys = _keys(name)
    for lab, kk in (("CPSAT", keys.get("key")), ("GA", keys.get("ga_key"))):
        if kk:
            val[lab] = metrics(run4(inst, None, sv, bv, iv, rule, key=kk))
            sc_v[lab] = score(val[lab], base_m, v)
    pool = {"best_rule": 0.0, "IIP": sc_v[iip_name], "C*": sc_v[c_star], "LA*": sc_v[la_star]}
    pool.update({k: sc_v[k] for k in ("CPSAT", "GA") if k in sc_v})
    champ = max(pool, key=pool.get)
    out = {"rule": rule, "rule_val": rule_ms, "val": val, "val_scores": sc_v, "C*": c_star, "LA*": la_star,
           "iip": {"pick": iip["pick"], "name": iip_name}, "pool": pool, "champion": champ, "h_star_a3": _h_star_a3(name),
           "holdout": None, "V": v, "sec_rule": t_rule, "sec_la": t_la}
    if n_hold <= 0:                      # набор F: H0-A4 не считается (поправка П3), holdout — только в V5
        out["sec"] = time.time() - t0
        save(path, out)
        print(f"{name}: правило {rule}, C* {c_star} ({sc_v[c_star]:+.4f}), LA* {la_star} ({sc_v[la_star]:+.4f}), "
              f"IIP {iip['pick']}, C** {champ} [{out['sec']:.0f} с; без H0]", flush=True)
        return name, out
    # Holdout (первые n_hold, base): библиотека ∪ LA → ex-post оракул; контроль H*_A3 (+ ход погашения A3).
    sh, bh = scen4("hold", n_hold)
    ih = list(range(n_hold))
    rows = {k: run4(inst, _pol(h), sh, bh, ih, rule) for k, h in {**lib, **las}.items()}
    keys_l = list(rows)
    P = np.stack([[r["profit"] for r in rows[k]] for k in keys_l])
    C = np.stack([[r["min_cash"] for r in rows[k]] for k in keys_l])
    bk = P.argmax(0)
    oracle_rows = [{**rows[keys_l[k]][i], "profit": float(P[k, i]), "min_cash": float(C[k, i])} for i, k in enumerate(bk)]
    hold = {"best_rule": metrics(rows["noop"]), "C*": metrics(rows[c_star]), "LA*": metrics(rows[la_star]),
            "IIP": metrics(rows[iip_name]), "oracle_bound": metrics(oracle_rows), "_V": v}
    for lab in ("LA>0", "LA>0.05", "LA>0.2"):
        hold[lab] = metrics(rows[lab])
    hs = _h_star_a3(name)
    if hs is not None:
        hold["H*_A3"] = metrics(rows[hs])
    out = {"rule": rule, "rule_val": rule_ms, "val": val, "val_scores": sc_v, "C*": c_star, "LA*": la_star,
           "iip": {"pick": iip["pick"], "name": iip_name}, "pool": pool, "champion": champ, "h_star_a3": hs,
           "holdout": hold, "oracle_use": {keys_l[k]: int(c) for k, c in zip(*np.unique(bk, return_counts=True))},
           "V": v, "sec": time.time() - t0, "sec_rule": t_rule, "sec_la": t_la}
    save(path, out)
    print(f"{name}: правило {rule}, C* {c_star} ({sc_v[c_star]:+.4f}), LA* {la_star} ({sc_v[la_star]:+.4f}), IIP {iip['pick']}, "
          f"C** {champ} [{out['sec']:.0f} с; LA {t_la:.0f} с]", flush=True)
    return name, out


def aggregate() -> dict:
    res, tabs = {}, {}
    for kind in ("A3", "F"):
        names = [n for n in set_names(kind) if (BASE_DIR / f"{n}.json").exists()]
        if not names:
            continue
        res[kind] = {n: json.loads((BASE_DIR / f"{n}.json").read_text(encoding="utf-8")) for n in names}
        names = [n for n in names if res[kind][n].get("holdout")]
        if not names:
            continue
        per = {n: {**r["holdout"], "C**": r["holdout"].get(r["champion"], r["holdout"]["C*"])} for n, r in res[kind].items() if n in names}
        pairs = [("C*", "best_rule"), ("LA*", "C*"), ("IIP", "best_rule"), ("oracle_bound", "C*"), ("oracle_bound", "best_rule"),
                 ("LA>0", "C*"), ("C**", "C*")]
        if kind == "A3":
            pairs.append(("C*", "H*_A3"))
        tabs[kind] = {f"{a}_vs_{b}": compare_sets(per, names, a, b) for a, b in pairs}
        for k, t in tabs[kind].items():
            d, c = t["d_cvar_profit"], t["d_cvar_cash"]
            print(f"[{kind}] {k:26s} ΔCVaR(Π) IQM {d['iqm']:+.3f}% V [{d['ci95'][0]:+.3f}; {d['ci95'][1]:+.3f}] p={d['wilcoxon_p']:.3g} "
                  f"доля {d['win_share']:.2f} | ΔCVaR(Cmin) {c['iqm']:+.3f} | ΔE {t['d_mean_profit']['iqm']:+.3f}", flush=True)
    champs = {n: {k: r[k] for k in ("rule", "C*", "LA*", "champion", "pool", "V", "h_star_a3")} | {"iip_pick": r["iip"]["pick"]}
              for kind in res for n, r in res[kind].items()}
    save(A4_RES / "baselines_a4.json", {"tables": tabs, "instances": {k: {n: {kk: vv for kk, vv in r.items() if kk not in ("val",)}
                                                                         for n, r in v.items()} for k, v in res.items()}})
    save(A4_RES / "champions_a4.json", champs)
    return tabs


# ── Сдвиг эталонных чисел A3 от продуктовых исправлений (до A4: без погашения линии; налог уже нарастающим) ──
def _shift_one(args) -> tuple[str, dict]:
    name, n = args
    from rl.eval.a3_common import load_a3
    from rl.train.train_l3 import heuristic
    ch = json.loads((A3_RES / "champions_a3.json").read_text(encoding="utf-8"))[name]
    js = json.loads(load_a3(name).to_json())
    me = __import__("rl.env.core", fromlist=["load_module"]).load_module()
    sh, bh = scen4("hold", n)
    idx = list(range(n))
    h = None if ch["h_star"] == "noop" else heuristic(ch["h_star"])
    out = {"_V": value_of(name)}
    for mode, flags in (("old", {"auto_repay": False}), ("new", {"auto_repay": True}), ("old_monthly_tax", {"auto_repay": False, "tax_cumulative": False})):
        j2 = json.loads(json.dumps(js)); j2["fin"].update(flags)
        inst = me.Instance.from_json(json.dumps(j2))
        out[f"best_rule|{mode}"] = metrics(run_struct(inst, None, sh, idx, bh, dispatch=(ch["rule"], [])))
        out[f"H*|{mode}"] = metrics(run_struct(inst, h, sh, idx, bh, dispatch=(ch["rule"], [])))
        if mode == "old":
            out["H*+sweep|old"] = metrics(run_struct(inst, with_sweep(h), sh, idx, bh, dispatch=(ch["rule"], [])))
    print(name, "сдвиг готов", flush=True)
    return name, out


def shift(workers: int, n: int) -> dict:
    names = set_names("A3")
    with ProcessPoolExecutor(workers) as ex:
        per = dict(ex.map(_shift_one, [(nm, n) for nm in names]))
    tab = {}
    for a, b in (("best_rule|new", "best_rule|old"), ("H*|new", "H*|old"), ("H*|new", "H*+sweep|old"),
                 ("H*|old", "best_rule|old"), ("H*+sweep|old", "best_rule|old"), ("H*|new", "best_rule|new"),
                 ("best_rule|old", "best_rule|old_monthly_tax"), ("H*|old", "H*|old_monthly_tax")):
        tab[f"{a} − {b}"] = compare_sets(per, names, a, b)
        d = tab[f"{a} − {b}"]["d_cvar_profit"]
        print(f"{a:16s} − {b:26s} ΔCVaR(Π) IQM {d['iqm']:+.3f}% V [{d['ci95'][0]:+.3f}; {d['ci95'][1]:+.3f}] "
              f"ΔE {tab[f'{a} − {b}']['d_mean_profit']['iqm']:+.3f}", flush=True)
    save(A4_RES / "shift_a3.json", {"n": n, "per_instance": per, "tables": tab})
    return tab


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--set", choices=["A3", "F"], default="A3")
    ap.add_argument("--n-hold", type=int, default=100)
    ap.add_argument("--workers", type=int, default=9)
    ap.add_argument("--aggregate", action="store_true")
    ap.add_argument("--shift", action="store_true")
    ap.add_argument("--only", nargs="*")
    a = ap.parse_args()
    if a.aggregate:
        aggregate(); return
    if a.shift:
        shift(a.workers, 200); return
    names = a.only or set_names(a.set)
    n_hold = 0 if a.set == "F" else a.n_hold          # поправка П3: H0-A4 только на A3
    BASE_DIR.mkdir(parents=True, exist_ok=True)
    # Крупные экземпляры — первыми (балансировка пула процессов).
    names = sorted(names, key=lambda n: {"l": 0, "m": 1, "s": 2}[n.split("-")[1][0]])
    with ProcessPoolExecutor(a.workers) as ex:
        list(ex.map(_instance, [(n, n_hold) for n in names]))


if __name__ == "__main__":
    main()
