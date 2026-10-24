"""Общее для A4 (rl/eval/prereg_a4.md): наборы экземпляров A3 и F (свежий, seed 20261024), сценарии (валидация 128),
таблица взгляда вперёд инвестиций (кэш по сигнатуре «экземпляр, неделя»), наблюдение A4 (80 признаков), неучащиеся
политики LA(θ) на признаках последствий, выбор C* / LA* / C** на валидации.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Sequence

import numpy as np

from rl.bench.instances_a3 import OUT as A3_DIR
from rl.env.core import load_module, make_config
from rl.env.l3_env import A, F, run_struct
from rl.env.scenarios import HOLDOUT_SEED, STRESSES, ScenarioSet
from rl.eval.a3_common import (HOLD_BASE, TRAIN_BASE, TRAIN_SEED, VALID_BASE, VALID_SEED, compare, metrics, save,
                               score)
from rl.eval.struct_policies import _pick
from rl.train.common import RESULTS

A4_RES = RESULTS / "a4"
F_DIR = A3_DIR.parent / "instances_a4f"
N_VALID4 = 128                       # §3: валидация (первые 32 = валидация A3)
LA_N, LA_POOL = 20, "base"           # §6: сценарии таблицы взгляда вперёд (обучающий пул)
CFG4 = {"struct_obs_a4": True}       # наблюдение A4 (SimEnvStruct.cpp:build_obs_a4)
N_OBS4 = 80
# Индексы признаков A4 (SimEnv::build_obs_a4).
F4 = {"ot_pen": 48, "ot_hor": 49, "ot_fee": 50, "ot_net": 51, "out_pen": 52, "out_hor": 53, "out_fee": 54,
      "out_net": 55, "inv": 56, "liq": 68, "liq_after": 69, "cls": 72, "limit": 75, "c0": 76, "fixed": 77,
      "margin": 78, "capex0": 79}


def set_names(kind: str) -> list[str]:
    d = A3_DIR if kind == "A3" else F_DIR
    return list(json.loads((d / "index.json").read_text(encoding="utf-8")).keys())


def inst_path(name: str) -> Path:
    return (F_DIR if name.startswith("a4f-") else A3_DIR) / f"{name}.json"


@lru_cache(maxsize=None)
def inst_json(name: str) -> str:
    return inst_path(name).read_text(encoding="utf-8")


def value_of(name: str) -> float:
    js = json.loads(inst_json(name))
    return float(sum(o["price"] * o["qty"] for o in js["orders"]))


def scen4(kind: str, n: int, stress: str = "base") -> tuple[ScenarioSet, int]:
    if kind == "valid":
        return ScenarioSet(n, VALID_SEED, stress=STRESSES[stress]), VALID_BASE
    if kind == "train":
        return ScenarioSet(n, TRAIN_SEED, stress=STRESSES[stress]), TRAIN_BASE
    return ScenarioSet(n, HOLDOUT_SEED, stress=STRESSES[stress]), HOLD_BASE


# ── Взгляд вперёд инвестиций (§6, признаки 56–67) ───────────────────────────────────────────────────────────────
def la_path(name: str) -> Path:
    return A4_RES / "la" / f"{name}.json"


def invest_lookahead(name: str, rule: str, threads: int = 1) -> list:
    """Таблица [кандидат][неделя заказа] = [ΔCVaR₀.₁(Π) % V, ΔE[Π] % V, ΔP(разрыва), ЧДД % V] — InvestEval на LA_N
    обучающих сценариях (пул base), диспетчеризация — лучшим правилом экземпляра; кэш на диске."""
    p = la_path(name)
    if p.exists():
        return json.loads(p.read_text(encoding="utf-8"))["table"]
    me = load_module()
    inst = me.Instance.from_json(inst_json(name))
    js = json.loads(inst_json(name))
    v = value_of(name)
    sc, base = scen4("train", LA_N, LA_POOL)
    scj, seeds = [sc.scenario_json(i) for i in range(LA_N)], [base + i for i in range(LA_N)]
    cfg = make_config({"dense_reward": False})
    table = []
    for c, cand in enumerate(js.get("a3", {}).get("invest_cands", [])):
        row = []
        last = 26 - int(np.ceil(float(cand.get("lead_weeks", 6))))      # ввод до конца горизонта (маска SimEnv)
        for w in range(26):
            if w >= last:
                row.append([0.0, 0.0, 0.0, 0.0]); continue
            r = json.loads(me.invest_eval(inst, cfg, c, scj, seeds, rule, [], w, 260, 0.0, threads))
            row.append([100.0 * (r["profit_cvar"] - r["profit_cvar_base"]) / v, 100.0 * r["d_profit_mean"] / v,
                        r["p_cash_gap"] - r["p_cash_gap_base"], 100.0 * r["npv_mean"] / v])
        table.append(row)
    save(p, {"rule": rule, "n": LA_N, "pool": LA_POOL, "table": table})
    return table


def load4(name: str, table: list | None = None):
    """Экземпляр с таблицей взгляда вперёд (a3.invest_la) — вход SimEnv с наблюдением A4."""
    js = json.loads(inst_json(name))
    if table is None and la_path(name).exists():
        table = json.loads(la_path(name).read_text(encoding="utf-8"))["table"]
    js.setdefault("a3", {})["invest_la"] = table or []
    return load_module().Instance.from_json(json.dumps(js))


def run4(inst, pol, sc: ScenarioSet, base: int, idx: Sequence[int], rule: str, key: list[float] | None = None,
         static_invest: Sequence[tuple[int, int]] = (), twin: bool = False, record: bool = False) -> list[dict]:
    return run_struct(inst, pol, sc, idx, base, cfg=CFG4, dispatch=(rule, key or []), static_invest=static_invest,
                      twin=twin, record=record)


# ── LA(θ): жадная по последствиям неучащаяся политика (§4 п.5) ──────────────────────────────────────────────────
class LookAhead:
    """Купить кандидата c, если ΔCVaR(Π) > θ, ΔE[Π] > 0, ΔP(разрыва) ≤ 0, запас после транша > 0 (лучший по ΔCVaR);
    «срочный первым» при срочном заказе; сверхурочные / субподряд, если прогнозная чистая выгода > θ (% V)."""

    def __init__(self, theta: float):
        self.theta = float(theta)
        self.name = f"LA>{theta:g}"

    def __call__(self, obs: np.ndarray, mask: np.ndarray) -> np.ndarray:
        th = self.theta
        inv = obs[:, F4["inv"]:F4["inv"] + 12].reshape(len(obs), 3, 4)
        ok = (inv[:, :, 0] > th) & (inv[:, :, 1] > 0) & (inv[:, :, 2] <= 0) & (obs[:, F4["liq_after"]:F4["liq_after"] + 3] > 0)
        ok &= mask[:, A["invest0"]:A["invest0"] + 3].astype(bool)
        best = np.where(ok, inv[:, :, 0], -np.inf).argmax(1)
        any_inv = ok.any(1)
        cands = []
        for c in range(3):
            cands.append((any_inv & (best == c), A[f"invest{c}"]))
        cands.append((obs[:, F["rush_rem"]] > 0, A["dispatch_expedite"]))
        cands.append((obs[:, F4["ot_net"]] > th, A["overtime"]))
        cands.append((obs[:, F4["out_net"]] > th, A["outsource_op"]))
        return _pick(mask, *cands)


LA_THETAS = (0.0, 0.05, 0.2)


def la_family() -> list[LookAhead]:
    return [LookAhead(t) for t in LA_THETAS]


def compare_sets(per: dict, names: Sequence[str], cand: str, base: str) -> dict:
    return compare(per, names, cand, base)


__all__ = ["A4_RES", "F_DIR", "N_VALID4", "CFG4", "N_OBS4", "F4", "set_names", "inst_json", "value_of", "scen4",
           "invest_lookahead", "load4", "run4", "LookAhead", "la_family", "metrics", "score", "save", "compare_sets"]
