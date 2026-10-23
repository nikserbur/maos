"""Реактивное управление под неопределённостью (A2, METHODOLOGY-V2 §7.1 «оперативное перепланирование»).

Общие функции стенда: статические кандидаты (7 правил, очередь по ключу CP-SAT, ключ ГА — считаются ДО
исполнения по средним и только воспроизводятся), статический чемпион экземпляра (по валидации, не по
holdout), ручные оракулы (переключение правила по наблюдаемым экстренным событиям), метрики экстренного
реагирования на отложенных сценариях со CRN-двойниками «без шока».

Индексы наблюдения L0 (SimEnv::build_obs_l0): слот s — obs[12s : 12s+12] (f[0] длительность, f[2] запас по
сроку); глобальные g = obs[192:]: g[14] отказ активен, g[15] шок уже был, g[16] доля невыполненной срочной
работы, g[17] поставка запаздывает.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Callable

import numpy as np

from rl.env.l0_env import A_CPSAT, A_DEFAULT, A_EXPEDITE, RULES
from rl.train.common import (ALPHA_PROFIT, RESULTS, RuleSelectPolicy, cvar_lower, episode_metrics, paired_bootstrap_ci,
                             run_episodes, wilcoxon_p)

STATIC = list(RULES) + ["CPSAT"]           # 8 статических кандидатов (индекс = действие 0..7)
ACTION_NAMES = STATIC + ["DEFAULT", "EXPEDITE"]
G0 = 16 * 12                               # начало глобальных признаков в obs_l0
CFG = {"breakdowns": True}


def load_cp_keys(path: Path = RESULTS / "cpsat_keys_a2.json") -> dict:
    if not path.exists():
        return {}
    return {k: v["key"] for k, v in json.loads(path.read_text(encoding="utf-8")).items() if v.get("key")}


def run_static(inst, a: int, scen, idx, seed_base: int, cp_key, twin: bool = False) -> list[dict]:
    if a == A_CPSAT:
        return run_episodes(inst, "key", scen, idx, seed_base, CFG, key=cp_key, twin=twin)
    return run_episodes(inst, f"rule:{RULES[a]}", scen, idx, seed_base, CFG, twin=twin)


def static_champions(names, insts, scen, n: int, cp_keys: dict, seed_base: int = 10_000) -> dict:
    """По ВАЛИДАЦИОННЫМ сценариям: лучшее правило (7, протокол A1) и статический чемпион (8 с CP-SAT)
    по CVaR_0.1 прибыли; плюс разброс CVaR между статиками (запас для переключения)."""
    out = {}
    for name, inst in zip(names, insts):
        cv = {}
        for a in range(len(STATIC)):
            if a == A_CPSAT and name not in cp_keys:
                continue
            rows = run_static(inst, a, scen, list(range(n)), seed_base, cp_keys.get(name))
            cv[a] = cvar_lower(np.array([r["profit"] for r in rows]), ALPHA_PROFIT)
        best_rule = max((a for a in cv if a < A_CPSAT), key=lambda a: cv[a])
        champ = max(cv, key=lambda a: cv[a])
        out[name] = {"best_rule": RULES[best_rule], "best_rule_a": best_rule, "champion_a": champ,
                     "champion": STATIC[champ], "cvar": {STATIC[a]: v for a, v in cv.items()}}
    return out


# ── Оракулы: переключение по НАБЛЮДАЕМЫМ событиям (будущее не используется) ─────────────────────
def _g(obs: np.ndarray) -> np.ndarray:
    return obs[:, G0:]


def _slack_min(obs: np.ndarray) -> np.ndarray:
    f = obs[:, :G0].reshape(len(obs), 16, 12)
    present = f[:, :, 0] > 0
    sl = np.where(present, f[:, :, 2], np.inf)
    return sl.min(axis=1)


def _ncands(obs: np.ndarray) -> np.ndarray:
    return (obs[:, :G0].reshape(len(obs), 16, 12)[:, :, 0] > 0).sum(axis=1)


def oracle(kind: str) -> Callable[[np.ndarray, np.ndarray], np.ndarray]:
    E, S, M = RULES.index("EDD"), RULES.index("SPT"), RULES.index("MS")
    D = A_DEFAULT

    def f(obs: np.ndarray, mask: np.ndarray) -> np.ndarray:
        g = _g(obs)
        if kind == "after_shock_edd":
            return np.where(g[:, 15] > 0, E, D)
        if kind == "after_shock_ms":
            return np.where(g[:, 15] > 0, M, D)
        if kind == "rush_edd":
            return np.where(g[:, 16] > 0, E, D)
        if kind == "outage_spt":
            return np.where(g[:, 14] > 0, S, D)
        if kind == "late_ms":
            return np.where(_slack_min(obs) < 0, M, D)
        if kind == "late_edd":
            return np.where(_slack_min(obs) < 0, E, D)
        if kind == "queue_spt":
            return np.where(_ncands(obs) >= 8, S, D)
        if kind == "shock_adaptive":
            return np.where(g[:, 14] > 0, S, np.where(g[:, 16] > 0, E, np.where(g[:, 15] > 0, M, D)))
        if kind == "rush_expedite":
            return np.where(g[:, 16] > 0, A_EXPEDITE, D)
        if kind == "always_expedite":
            return np.full(len(obs), A_EXPEDITE)
        if kind == "shock_late_ms":
            return np.where((g[:, 15] > 0) & (_slack_min(obs) < 0), M, D)
        return np.full(len(obs), D)
    return f


ORACLES = ["rush_expedite", "always_expedite", "after_shock_edd", "after_shock_ms", "rush_edd", "outage_spt", "late_ms", "late_edd", "queue_spt",
           "shock_adaptive", "shock_late_ms"]


def rs_policy(champs: dict, cp_keys: dict, model=None, fn=None, delta_h: float = 0.0) -> RuleSelectPolicy:
    return RuleSelectPolicy(model=model, fn=fn, defaults={n: c["champion_a"] for n, c in champs.items()}, cp_keys=cp_keys,
                            delta_h=delta_h)


def eval_rows(inst, spec, scen, idx, seed_base: int, cp_key=None, twin: bool = False) -> list[dict]:
    """spec: ('static', a) | ('key', key) | ('rs', RuleSelectPolicy)."""
    kind, v = spec
    if kind == "static":
        return run_static(inst, v, scen, idx, seed_base, cp_key, twin)
    if kind == "key":
        return run_episodes(inst, "key", scen, idx, seed_base, CFG, key=v, twin=twin)
    return run_episodes(inst, v, scen, idx, seed_base, CFG, twin=twin)


# ── Сравнения и метрики экстренного реагирования ─────────────────────────────────────────────
def compare_rows(res: dict, names, cand: str, base: str) -> dict:
    """Как v5.compare: парные разности по экземплярам, IQM + бутстреп-ДИ, Уилкоксон, гейт."""
    d_prof, d_cash = [], []
    for n in names:
        a, b = episode_metrics(res[cand][n]), episode_metrics(res[base][n])
        s = max(1.0, abs(b["profit_mean"]))
        d_prof.append((a["profit_cvar"] - b["profit_cvar"]) / s)
        d_cash.append((a["cash_min_cvar"] - b["cash_min_cvar"]) / s)
    out = {}
    for k, d in (("d_cvar_profit", d_prof), ("d_cvar_cash", d_cash)):
        m, lo, hi = paired_bootstrap_ci(np.array(d))
        out[k] = {"iqm": m, "ci95": [lo, hi], "mean": float(np.mean(d)), "wilcoxon_p": wilcoxon_p(np.array(d)),
                  "win_share": float(np.mean(np.array(d) > 0)), "per_instance": [float(x) for x in d]}
    out["gate_pass"] = bool(out["d_cvar_profit"]["ci95"][0] > 0 and out["d_cvar_cash"]["iqm"] >= 0)
    return out


def emergency(res: dict, twin: dict, names, cand: str, base: str, b: int = 2000, seed: int = 3) -> dict:
    """Экстренное реагирование на шоковых сценариях (пары по экземпляру × сценарию, CRN):
    время восстановления пропускной способности, потери просрочки/прибыли/кассы, приписываемые шоку
    (шок − двойник без шока), доля шоков, где кандидат лучше базы по прибыли. ДИ — бутстреп по парам."""
    rec, d_tard, d_prof, d_cash, win = [], [], [], [], []
    for n in names:
        for ra, rb, ta, tb in zip(res[cand][n], res[base][n], twin[cand][n], twin[base][n]):
            if not ra["shock"].get("has_shock"):
                continue
            rec.append(ra["shock"]["recovery_h"] - rb["shock"]["recovery_h"])
            la_t, lb_t = ra["tardiness_h"] - ta["tardiness_h"], rb["tardiness_h"] - tb["tardiness_h"]
            la_p, lb_p = ta["profit"] - ra["profit"], tb["profit"] - rb["profit"]          # потеря прибыли от шока
            la_c, lb_c = ta["min_cash"] - ra["min_cash"], tb["min_cash"] - rb["min_cash"]
            d_tard.append(la_t - lb_t); d_prof.append(la_p - lb_p); d_cash.append(la_c - lb_c)
            win.append(1.0 if ra["profit"] > rb["profit"] + 1e-6 else 0.0)
    rng = np.random.default_rng(seed)

    def ci(x: list[float]) -> dict:
        x = np.asarray(x, float)
        if len(x) == 0:
            return {"mean": 0.0, "ci95": [0.0, 0.0], "n": 0}
        bs = [float(x[rng.integers(0, len(x), len(x))].mean()) for _ in range(b)]
        return {"mean": float(x.mean()), "ci95": [float(np.percentile(bs, 2.5)), float(np.percentile(bs, 97.5))], "n": int(len(x))}
    return {"d_recovery_h": ci(rec), "d_shock_tardiness_h": ci(d_tard), "d_shock_profit_loss": ci(d_prof),
            "d_shock_cash_loss": ci(d_cash), "win_share": ci(win)}


def action_usage(policy: RuleSelectPolicy) -> dict:
    """Где политика переключает правила: доли действий по экземплярам (интерпретация)."""
    return {n: {ACTION_NAMES[a]: float(c[a] / max(1, c.sum())) for a in range(len(c)) if c[a] > 0}
            for n, c in policy.counts.items()}
