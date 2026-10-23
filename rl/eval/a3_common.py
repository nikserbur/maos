"""Общее для A3 (rl/eval/prereg_a3.md): экземпляры семейства, наборы сценариев, метрики в % стоимости портфеля,
парные сравнения по экземплярам (IQM + бутстреп-ДИ + Уилкоксон), выбор лучшего правила / IIP / эвристики /
чемпиона на ВАЛИДАЦИИ.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Sequence

import numpy as np

from rl.bench.instances_a3 import OUT as A3_DIR
from rl.env.core import load_module, make_config
from rl.env.l3_env import run_struct
from rl.env.scenarios import HOLDOUT_SEED, STRESSES, ScenarioSet
from rl.eval.struct_policies import Heuristic, heuristic_grid
from rl.train.common import RESULTS, RULES, cvar_lower, paired_bootstrap_ci, wilcoxon_p

A3_RES = RESULTS / "a3"
VALID_SEED, VALID_BASE, N_VALID = 777, 10_000, 32          # §3 предрегистрации
HOLD_BASE = 50_000
TRAIN_SEED, TRAIN_BASE, N_TRAIN = 20261104, 0, 512
ALPHA, BETA = 0.10, 0.05


def a3_names() -> list[str]:
    return list(json.loads((A3_DIR / "index.json").read_text(encoding="utf-8")).keys())


def load_a3(name: str):
    return load_module().Instance.from_json((A3_DIR / f"{name}.json").read_text(encoding="utf-8"))


def value_of(name: str) -> float:
    js = json.loads((A3_DIR / f"{name}.json").read_text(encoding="utf-8"))
    return float(sum(o["price"] * o["qty"] for o in js["orders"]))


def scen(kind: str, n: int, stress: str = "base") -> tuple[ScenarioSet, int]:
    """(набор, seed_base) — валидация | holdout | обучение."""
    if kind == "valid":
        return ScenarioSet(n, VALID_SEED, stress=STRESSES[stress]), VALID_BASE
    if kind == "train":
        return ScenarioSet(n, TRAIN_SEED, stress=STRESSES[stress]), TRAIN_BASE
    return ScenarioSet(n, HOLDOUT_SEED, stress=STRESSES[stress]), HOLD_BASE


def metrics(rows: list[dict]) -> dict:
    p = np.array([r["profit"] for r in rows]); c = np.array([r["min_cash"] for r in rows])
    liq = np.array([r.get("min_liquidity", 0.0) for r in rows])
    return {"n": len(rows), "profit_mean": float(p.mean()), "profit_cvar": cvar_lower(p, ALPHA), "cash_min_cvar": cvar_lower(c, BETA),
            "liq_cvar": cvar_lower(liq, BETA), "p_breach": float(np.mean([r["breach"] for r in rows])),
            "otd": float(np.mean([r["otd"] for r in rows])), "tardiness_h": float(np.mean([r["tardiness_h"] for r in rows])),
            "moves": float(np.mean([r["n_moves"] for r in rows]))}


def score(m: dict, base: dict, v: float) -> float:
    """Балл валидации (§4 п.6): ΔCVaR₀.₁(Π)/V + 0.5·ΔCVaR₀.₀₅(C_min)/V к базе."""
    return ((m["profit_cvar"] - base["profit_cvar"]) + 0.5 * (m["cash_min_cvar"] - base["cash_min_cvar"])) / v


def compare(per_inst: dict, names: Sequence[str], cand: str, base: str) -> dict:
    """Парные разности по экземплярам в % V: ΔCVaR₀.₁(Π), ΔCVaR₀.₀₅(C_min), ΔE[Π]; IQM, ДИ, Уилкоксон, гейт."""
    out = {}
    d = {"d_cvar_profit": [], "d_cvar_cash": [], "d_mean_profit": []}
    for n in names:
        a, b, v = per_inst[n][cand], per_inst[n][base], per_inst[n]["_V"]
        d["d_cvar_profit"].append(100 * (a["profit_cvar"] - b["profit_cvar"]) / v)
        d["d_cvar_cash"].append(100 * (a["cash_min_cvar"] - b["cash_min_cvar"]) / v)
        d["d_mean_profit"].append(100 * (a["profit_mean"] - b["profit_mean"]) / v)
    for k, x in d.items():
        x = np.asarray(x)
        m, lo, hi = paired_bootstrap_ci(x)
        out[k] = {"iqm": m, "ci95": [lo, hi], "mean": float(x.mean()), "wilcoxon_p": wilcoxon_p(x),
                  "win_share": float(np.mean(x > 0)), "per_instance": [float(y) for y in x]}
    out["gate_pass"] = bool(out["d_cvar_profit"]["ci95"][0] > 0 and out["d_cvar_cash"]["iqm"] >= 0)
    return out


def iip_decide(inst, rule: str, sc: ScenarioSet, base: int, idx: Sequence[int], key: list[float] | None = None) -> dict:
    """«Инвестируй, если окупается» на наборе sc: оценка всех кандидатов L3 (C++ invest_eval), выбор кандидата с
    наибольшим E[ЧДД] среди прошедших правило применения; -1 → не покупать."""
    me = load_module()
    cfg = make_config({"dense_reward": False})
    ev = []
    for c in range(len(json.loads(inst.to_json())["a3"]["invest_cands"])):
        r = json.loads(me.invest_eval(inst, cfg, c, [sc.scenario_json(i) for i in idx], [base + i for i in idx], rule,
                                      key or [], 0, 260, 0.0, 1))
        ev.append(r)
    ok = [c for c, r in enumerate(ev) if r["apply"]]
    pick = max(ok, key=lambda c: ev[c]["npv_mean"]) if ok else -1
    return {"pick": pick, "eval": ev}


def run_policy(inst, pol, sc: ScenarioSet, base: int, idx: Sequence[int], rule: str, key: list[float] | None = None,
               static_invest: Sequence[tuple[int, int]] = (), twin: bool = False) -> list[dict]:
    p = None if (isinstance(pol, Heuristic) and pol.name == "noop" and not pol.invest) else pol
    return run_struct(inst, p, sc, idx, base, dispatch=(rule, key or []), static_invest=static_invest, twin=twin)


def best_rule(inst, v: float) -> tuple[str, dict]:
    sc, b = scen("valid", N_VALID)
    idx = list(range(N_VALID))
    ms = {r: metrics(run_struct(inst, None, sc, idx, b, dispatch=(r, []))) for r in RULES}
    best = max(RULES, key=lambda r: (ms[r]["profit_cvar"], ms[r]["profit_mean"]))
    return best, ms


def library() -> list[Heuristic]:
    """Библиотека неучащихся политик (сетка + варианты с покупкой каждого кандидата в неделю 0)."""
    g = heuristic_grid()
    lib = list(g)
    for c in range(3):
        lib += [Heuristic(f"{h.name}+inv{c}", ot=h.ot, out=h.out, expedite=h.expedite, draw=h.draw, ot_always=h.ot_always,
                          invest=(c,)) for h in g]
    return lib


def save(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=1, ensure_ascii=False), encoding="utf-8")
