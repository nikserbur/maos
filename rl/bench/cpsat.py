"""Детерминированный эталон CP-SAT (OR-Tools) для FJSP — METHODOLOGY-V2 §7.1, V4 (лимит 60 с [НОРМ]).

Модель: интервал на операцию; альтернативные станки — необязательные интервалы с ровно одним
присутствующим; NoOverlap по станку; предшествование по графу джоб SimEnv; минимум Cmax.
Наладки и рабочие НЕ моделируются (на бенчмарках их нет; на экземплярах MAOS это релаксация →
значение = нижняя граница детерминированного Cmax с наладками, что и отчитывается).
"""
from __future__ import annotations

import json
import math
import time
from dataclasses import dataclass

from ortools.sat.python import cp_model


@dataclass(frozen=True)
class CpResult:
    makespan: float      # найденное значение (мин), inf если нет решения
    bound: float         # нижняя граница солвера
    status: str
    seconds: float
    n_ops: int


def solve_from_env(env, time_limit_s: float = 60.0, workers: int = 8, scale: float = 1.0) -> CpResult:
    """env — SimEnv после reset(); структура джоб из env.job_info(); длительности — средние (детерминированно)."""
    jobs = json.loads(env.job_info())
    machines_of = _machines_of(env)
    model = cp_model.CpModel()
    horizon = int(math.ceil(sum(max(j["dur"], max([t for _, t in j["dur_by_type"]] or [0])) for j in jobs) * scale)) + 1
    starts, ends, mach_intervals = {}, {}, {}
    for i, j in enumerate(jobs):
        alts = j["wc_types"] or []
        s = model.NewIntVar(int(j["release"] * scale), horizon, f"s{i}")
        e = model.NewIntVar(0, horizon, f"e{i}")
        starts[i], ends[i] = s, e
        if not alts:   # поставка без станка: фиксированная длительность
            model.Add(e == s + int(round(j["dur"] * scale)))
            continue
        pres = []
        by_type = dict(j["dur_by_type"]) if j["dur_by_type"] else {}
        for t in alts:
            d = int(round(by_type.get(t, j["dur"]) * scale))
            for m in machines_of.get(t, []):
                p = model.NewBoolVar(f"p{i}_{m}")
                iv = model.NewOptionalIntervalVar(s, d, e, p, f"iv{i}_{m}")
                mach_intervals.setdefault(m, []).append(iv)
                pres.append(p)
        if pres:
            model.AddExactlyOne(pres)
        else:
            model.Add(e == s + int(round(j["dur"] * scale)))
    for i, j in enumerate(jobs):
        for p in j["preds"]:
            model.Add(starts[i] >= ends[p])
    for m, ivs in mach_intervals.items():
        model.AddNoOverlap(ivs)
    cmax = model.NewIntVar(0, horizon, "cmax")
    model.AddMaxEquality(cmax, [ends[i] for i in range(len(jobs))])
    model.Minimize(cmax)
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = time_limit_s
    solver.parameters.num_workers = workers
    t0 = time.time()
    st = solver.Solve(model)
    sec = time.time() - t0
    name = solver.StatusName(st)
    if st in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return CpResult(solver.ObjectiveValue() / scale, solver.BestObjectiveBound() / scale, name, sec, len(jobs))
    return CpResult(math.inf, solver.BestObjectiveBound() / scale if st != cp_model.UNKNOWN else 0.0, name, sec, len(jobs))


def _machines_of(env) -> dict[str, list[str]]:
    inst = json.loads(env.instance_to_json())
    out: dict[str, list[str]] = {}
    for m in inst["machines"]:
        out.setdefault(m["wct"], []).append(m["id"])
    return out
