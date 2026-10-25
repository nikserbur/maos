"""CR-E1 §8 (цена ликвидности в лексикографическом оптимуме LP) и §11 (Стадия 1 на том же плане).

§8: фаза 1 — max CVaR_α(Π), фаза 2 — max E[Π] при CVaR ≥ CVaR* − ε (fin.cp.lexicographic, техн.). Плечи A0 и A2,
режимы base и crisis; Y° — без ограничения ликвидности, Y^L — на сетке L: шесть точек pol_curve, построенных на A0
base (те же абсолютные L для A2 и кризиса), плюс L = 0. Неопределённость — метод многократных репликаций
(Mak, Morton & Wood 1999): K = 10 независимых сидов (101…110) при N = 300, t-интервал по парным разностям (9 с. с.).
Сценарный бутстреп для величин LP не применяется: решение зависит от выборки.
Правило §8 (оговорено заранее): если задача LP при N = 1000 решается дольше 10 минут, точечная оценка берётся при
N = 500. Решение принято до запуска по времени задач плана x* при N = 1000, 26 нед. (рекурс 37–53 с, Y° 6–23 с) —
N = 1000. Лимит HiGHS считает время по стенке: стенд уходил в сон (pmset: Maintenance Sleep ~900 с из ~1050 с), поэтому
лимит поднят до 7200 с — иначе статус time_limit возникал бы от сна машины, а не от сложности задачи; статус
time_limit у нужной задачи по-прежнему переводит точечную оценку на N = 500. Задача «график траншей заранее»
(cash_lp.fixed_schedule) для §8 не нужна и пропускается (fixed_schedule = false): при N = 1000 она самая долгая.
"""
from __future__ import annotations

import numpy as np

from rl.eval import cr_e1_stats as st
from rl.eval.cr_e1_core import ARMS, BETA, H26, N_LP, N_REP, REGIMES, REP_SEEDS, SEED, Stand, merge

LP_LIMIT_S = 7200         # лимит HiGHS fin.cp.lp_time_limit_sec по стенке (сон стенда — см. выше)
N_FALLBACK = 500


def lp_body(arm: str, rg: str, seed: int, n: int, grid: list[float] | None) -> dict:
    body = merge({"cash": True, "objective": "cvar", "beta": BETA, "l_min": 0, "financing_stage": "recourse",
                  "seed": seed, "samples": n, "cash_samples": n, "pol_curve": True, "fixed_schedule": False, **H26},
                 REGIMES[rg], ARMS[arm], {"counterparty": {"lexicographic": True, "lp_time_limit_sec": LP_LIMIT_S}})
    if grid:
        body["pol_grid"] = grid
    return body


def lp_extract(res: dict) -> dict:
    """Y°, Y^L по сетке, двойственные цены, статусы, времена решения (мс)."""
    c = res["data"]["cash_lp"]
    u = c.get("unconstrained", {})
    pts = [{k: p.get(k) for k in ("l_min", "status", "expected", "cvar", "cfar", "local_dual", "solve_ms")}
           for p in c.get("pol_curve", [])]
    return {"status": c.get("status"), "expected": c.get("expected"), "cvar": c.get("cvar"),
            "lex": c.get("lexicographic"), "liquidity_dual": (c.get("duals") or {}).get("liquidity"),
            "free": {k: u.get(k) for k in ("status", "expected", "cvar", "cfar", "solve_ms")}, "points": pts,
            "solve_ms": {"recourse": c.get("solve_ms"), "fixed_schedule": (c.get("fixed_schedule") or {}).get("solve_ms"),
                         "unconstrained": u.get("solve_ms"), "grid": [p.get("solve_ms") for p in pts]},
            "total_ms": c.get("total_ms"), "wall_s": res["wall_s"]}


def pol(e: dict) -> dict[float, dict]:
    """PoL_CVaR(L) = CVaR*(Y°) − CVaR*(Y^L), PoL_E(L) = E Π(Y°) − E Π(Y^L); несовместные точки — флаг."""
    out = {}
    f = e["free"]
    for p in e["points"]:
        ok = p["status"] == "optimal" and f["status"] == "optimal"
        out[round(p["l_min"], 6)] = {"status": p["status"], "dual": p.get("local_dual"),
                                     "pol_cvar": f["cvar"] - p["cvar"] if ok else None,
                                     "pol_e": f["expected"] - p["expected"] if ok else None}
    return out


def needs_fallback(e: dict) -> bool:
    """Нужная задача (Y°, Y^L) упёрлась в лимит 10 минут → точечная оценка при N = 500."""
    sts = [e["free"]["status"]] + [p["status"] for p in e["points"]]
    return any(s == "time_limit" for s in sts)


def stage_lp(stand: Stand, workers: int) -> dict:
    n = N_LP
    first = lp_extract(stand.call(f"lp_A0_base_n{n}", "/api/optimize", lp_body("A0", "base", SEED, n, None)))
    if needs_fallback(first):
        n = N_FALLBACK
        first = lp_extract(stand.call(f"lp_A0_base_n{n}", "/api/optimize", lp_body("A0", "base", SEED, n, None)))
    grid = sorted({p["l_min"] for p in first["points"]} | {0.0})
    jobs = [(f"lp_{a}_{rg}_n{n}", "/api/optimize", lp_body(a, rg, SEED, n, grid))
            for a in ("A0", "A2") for rg in REGIMES if not (a == "A0" and rg == "base")]
    jobs += [(f"lprep_{a}_{rg}_s{s}", "/api/optimize", lp_body(a, rg, s, N_REP, grid))
             for s in REP_SEEDS for a in ("A0", "A2") for rg in REGIMES]
    res = stand.many(jobs, workers)
    point = {"A0/base": first, **{f"{a}/{rg}": lp_extract(res[f"lp_{a}_{rg}_n{n}"])
                                  for a in ("A0", "A2") for rg in REGIMES if not (a == "A0" and rg == "base")}}
    rep = {"n_point": n, "grid": grid, "point": point, "pol_point": {k: pol(v) for k, v in point.items()}}
    rep["delta_pol_point"] = {rg: delta_pol(pol(point[f"A2/{rg}"]), pol(point[f"A0/{rg}"])) for rg in REGIMES}
    rep["mrp"] = mrp(res, grid)
    return rep


def delta_pol(p2: dict, p0: dict) -> dict:
    out = {}
    for L in p0:
        a, b = p2.get(L, {}), p0[L]
        out[L] = {k: (a.get(k) - b[k]) if a.get(k) is not None and b.get(k) is not None else None
                  for k in ("pol_cvar", "pol_e")}
        out[L]["infeasible"] = {"A2": a.get("status") not in (None, "optimal"), "A0": b["status"] != "optimal"}
    return out


def mrp(res: dict, grid: list[float]) -> dict:
    """Метод многократных репликаций: по каждому L — t-интервалы PoL плеч и ΔPoL (парные по сиду)."""
    out = {}
    for rg in REGIMES:
        per = {a: [pol(lp_extract(res[f"lprep_{a}_{rg}_s{s}"])) for s in REP_SEEDS] for a in ("A0", "A2")}
        row = {}
        for L in (round(x, 6) for x in grid):
            r = {}
            for k in ("pol_cvar", "pol_e"):
                v0 = [p.get(L, {}).get(k) for p in per["A0"]]
                v2 = [p.get(L, {}).get(k) for p in per["A2"]]
                pairs = [(x2, x0) for x2, x0 in zip(v2, v0) if x2 is not None and x0 is not None]
                r[k] = {"A0": st.t_interval([x0 for _, x0 in pairs]) if pairs else None,
                        "A2": st.t_interval([x2 for x2, _ in pairs]) if pairs else None,
                        "delta": st.t_interval([x2 - x0 for x2, x0 in pairs]) if pairs else None, "k": len(pairs)}
            r["infeasible"] = {a: sum(p.get(L, {}).get("status") not in (None, "optimal") for p in per[a])
                               for a in ("A0", "A2")}
            row[L] = r
        out[rg] = row
    return out


# ── §11: Стадия 1 на том же плане ───────────────────────────────────────────────────────────────────────
def program_of(plan_res: dict, horizon_h: float) -> list[dict]:
    """Программа Стадии 1 = x* денежного LP (qty_rounded — кратно партии), срок — конец горизонта. run_id сервера
    не подходит: по нему планировщик берёт эвристический робастный портфель прогона, а не x*."""
    return [{"product_id": p["product_id"], "qty": p["qty_rounded"], "due_hours": horizon_h}
            for p in plan_res["data"]["cash_lp"]["portfolio"] if p["qty_rounded"] > 0]


def stage1(stand: Stand, program: list[dict]) -> dict:
    """run_schedule по программе x*: правило — лучшее в A0 (auto, CPR выкл.), improve_iters = 0, samples = 1000,
    seed 42; CPR выкл./вкл., режимы base и crisis (пути режимов MacroSampler)."""
    base = {"program": program, "improve_iters": 0, "samples": 1000, "seed": SEED, "per_scenario": True}
    auto = stand.call("s1x_auto_off", "/api/schedule", {**base, "rule": "auto", "counterparty": False})
    rule = auto["data"]["rule"]
    jobs = [("s1x_off", "/api/schedule", {**base, "rule": rule, "counterparty": False})]
    jobs += [(f"s1x_on_{rg}", "/api/schedule", {**base, "rule": rule, "counterparty": True, **extra})
             for rg, extra in REGIMES.items()]
    res = stand.many(jobs, workers=3)
    runs = {"off": res["s1x_off"], **{f"on_{rg}": res[f"s1x_on_{rg}"] for rg in REGIMES}}
    off = runs["off"]["data"]["mc_per_scenario"]
    idx = st.boot_indices(len(off["makespan_h"]), 2000, SEED)
    obj = lambda d: np.asarray(d["makespan_h"]) + 0.5 * np.asarray(d["tardiness_h"])  # noqa: E731  Θ + ½ΣT
    rep = {"rule": rule, "program": program, "n_orders": auto["data"].get("n_orders"), "n_jobs": auto["data"].get("n_jobs"),
           "wall_s": {k: v["wall_s"] for k, v in runs.items()}}
    for rg in REGIMES:
        on = runs[f"on_{rg}"]["data"]
        ps = on["mc_per_scenario"]
        rep[rg] = {"E_tardiness": st.delta_mean(ps["tardiness_h"], off["tardiness_h"], idx),
                   "E_makespan": st.delta_mean(ps["makespan_h"], off["makespan_h"], idx),
                   "cvar10_obj": st.delta_cvar_upper(obj(ps), obj(off), 0.10, idx),
                   "share_scenarios_delayed": on["counterparty"]["share_scenarios_delayed"],
                   "mean_delay_weeks": on["counterparty"]["mean_delay_weeks"],
                   "max_delay_weeks": on["counterparty"]["max_delay_weeks"],
                   "shortage_materials": on["counterparty"]["shortage_materials"],
                   "kpi_on": on["kpi"], "kpi_off": runs["off"]["data"]["kpi"]}
    return rep
