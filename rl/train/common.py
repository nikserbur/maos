"""Общее для обучения/оценки: экземпляры, наборы сценариев, батч-оценка политик, статистика.

IQM и парный бутстреп — по Agarwal et al. 2021 (rliable); Уилкоксон — scipy. Все оценки на
общих случайных числах: сценарий i одинаков для всех сравниваемых политик (CRN).
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Sequence

import numpy as np
from scipy import stats

from rl.bench import instances as bi
from rl.env.core import load_module, make_config
from rl.env.scenarios import ScenarioSet, StressSpec

REPO = bi.REPO
RESULTS = REPO / "rl" / "results"
CKPT = REPO / "rl" / "train" / "checkpoints"
RULES = ["EDD", "SPT", "LPT", "CR", "MWKR", "MS", "FIFO"]
ALPHA_PROFIT = 0.10   # α CVaR прибыли [К] (r1.19 / scenario.alpha)
BETA_CASH = 0.05      # β CVaR минимума кассы [К] fin.beta


def maos_instance_names() -> list[str]:
    index = json.loads((bi.OUT / "index.json").read_text(encoding="utf-8"))
    return [k for k in index if k.startswith("maos")]


def load_instances(names: Sequence[str]):
    me = load_module()
    return [me.Instance.from_json((bi.OUT / f"{n}.json").read_text(encoding="utf-8")) for n in names]


Policy = Callable[[np.ndarray, np.ndarray], np.ndarray]   # (obs[B,D], mask[B,A]) → действия[B]


def rule_policy(rule: str) -> str:
    return f"rule:{rule}"


def run_episodes(instance, policy: str | Policy, scenarios: ScenarioSet, idxs: Sequence[int], seed_base: int,
                 cfg: dict | None = None, key: list[float] | None = None, l2_policy: Policy | None = None,
                 l0_inner: str | Policy | None = None, twin: bool = False) -> list[dict]:
    """Прогон набора сценариев одной политикой; обученные политики — батчем по всем средам сразу.
    policy: 'rule:EDD' | 'key' (с key) | callable L0. l2_policy — политика L2 (если среда с L2)."""
    me = load_module()
    c = make_config(cfg)
    envs = [me.SimEnv(instance, c) for _ in idxs]
    for e, i in zip(envs, idxs):
        e.reset(seed_base + i, scenarios.twin_json(i) if twin else scenarios.scenario_json(i))   # twin — тот же сценарий без шоков (A2)
    out: list[dict | None] = [None] * len(envs)
    active = list(range(len(envs)))
    hold: list[tuple[int, float] | None] = [None] * len(envs)   # A2: (действие, до момента) для макро-шага Δ
    inner = l0_inner if l0_inner is not None else policy
    while active:
        # L2-эпохи
        l2 = [k for k in active if envs[k].level == 2]
        if l2:
            if l2_policy is None:
                for k in l2:
                    envs[k].step(0)
            else:
                obs = np.stack([envs[k].obs_l2() for k in l2]); mask = np.stack([envs[k].mask_l2() for k in l2]).astype(bool)
                acts = l2_policy(obs, mask)
                for k, a in zip(l2, acts):
                    envs[k].step(int(a))
        l0 = [k for k in active if envs[k].level == 0 and not envs[k].done]
        if l0:
            if isinstance(inner, str) and inner.startswith("rule:"):
                r = inner[5:]
                for k in l0:
                    envs[k].step_job(envs[k].rule_choice(r))
            elif inner == "key":
                for k in l0:
                    envs[k].step_job(envs[k].key_choice(key))
            elif getattr(inner, "rule_select", False):      # L0 как выбор правила (A2): действие → правило/CP-SAT/чемпион
                from rl.env.l0_env import A_CPSAT, N_ACTIONS, dispatch, resolve_action
                cpk = inner.cp_keys.get(instance.name) if inner.cp_keys else None
                dflt = inner.defaults.get(instance.name, 0) if inner.defaults else 0
                delta = getattr(inner, "delta_min", 0.0)
                need = [k for k in l0 if hold[k] is None or delta <= 0 or envs[k].now >= hold[k][1]]
                if need:
                    obs = np.stack([envs[k].obs_l0() for k in need])
                    mask = np.ones((len(need), N_ACTIONS), dtype=bool); mask[:, A_CPSAT] = cpk is not None
                    for k, a in zip(need, inner(obs, mask)):
                        hold[k] = (resolve_action(int(a), dflt, cpk is not None), envs[k].now + delta)
                for k in l0:
                    ra = hold[k][0]
                    inner.log_action(instance.name, ra)
                    envs[k].step_job(dispatch(envs[k], ra, cpk, dflt))
            else:
                obs = np.stack([envs[k].obs_l0() for k in l0]); mask = np.stack([envs[k].mask_l0() for k in l0]).astype(bool)
                acts = inner(obs, mask)
                for k, a in zip(l0, acts):
                    envs[k].step(int(a))
        for k in list(active):
            if envs[k].done:
                out[k] = json.loads(envs[k].summary())
                active.remove(k)
    return [o for o in out if o is not None]


def sb3_policy(model) -> Policy:
    """MaskablePPO → детерминированная батч-политика."""
    def f(obs: np.ndarray, mask: np.ndarray) -> np.ndarray:
        acts, _ = model.predict(obs, action_masks=mask, deterministic=True)
        return np.asarray(acts)
    return f


class RuleSelectPolicy:
    """Политика L0 «выбор правила» (A2): действие 0..6 — правило, 7 — ключ CP-SAT, 8 — статический
    чемпион экземпляра (defaults: имя экземпляра → действие 0..7; cp_keys: имя → ключ CP-SAT).
    model = None → «всегда чемпион» (BC-цель); fn(obs, mask) — произвольная политика (оракулы)."""
    rule_select = True

    def __init__(self, model=None, defaults: dict | None = None, cp_keys: dict | None = None, fn=None,
                 delta_h: float = 0.0) -> None:
        self.model, self.fn = model, fn
        self.delta_min = float(delta_h) * 60.0      # макро-шаг: действие держится Δ часов модельного времени
        self.defaults, self.cp_keys = defaults or {}, cp_keys or {}
        self.counts: dict[str, np.ndarray] = {}

    def __call__(self, obs: np.ndarray, mask: np.ndarray) -> np.ndarray:
        if self.fn is not None:
            return np.asarray(self.fn(obs, mask))
        if self.model is None:
            return np.full(len(obs), 8)
        acts, _ = self.model.predict(obs, action_masks=mask, deterministic=True)
        return np.asarray(acts)

    def log_action(self, name: str, a: int) -> None:
        c = self.counts.setdefault(name, np.zeros(10, dtype=np.int64))
        c[a] += 1


# ── Статистика ─────────────────────────────────────────────────────────────
def cvar_lower(x: np.ndarray, beta: float) -> float:
    """Среднее худших (наименьших) ⌊βN⌋ значений (как cash::cvar_lower)."""
    v = np.sort(np.asarray(x, dtype=float))
    k = max(1, int(np.floor(beta * len(v))))
    return float(v[:k].mean())


def iqm(x: np.ndarray) -> float:
    v = np.sort(np.asarray(x, dtype=float))
    n = len(v)
    lo, hi = int(np.floor(0.25 * n)), int(np.ceil(0.75 * n))
    return float(v[lo:hi].mean()) if hi > lo else float(v.mean())


def paired_bootstrap_ci(delta: np.ndarray, b: int = 2000, seed: int = 1, stat=iqm) -> tuple[float, float, float]:
    """(stat(Δ), lo95, hi95) — бутстреп по парным разностям (по экземплярам)."""
    rng = np.random.default_rng(seed)
    d = np.asarray(delta, dtype=float)
    n = len(d)
    if n == 0:
        return 0.0, 0.0, 0.0
    bs = np.array([stat(d[rng.integers(0, n, n)]) for _ in range(b)])
    return float(stat(d)), float(np.percentile(bs, 2.5)), float(np.percentile(bs, 97.5))


def wilcoxon_p(delta: np.ndarray) -> float:
    d = np.asarray(delta, dtype=float)
    d = d[np.abs(d) > 0]
    if len(d) < 3:
        return 1.0
    return float(stats.wilcoxon(d).pvalue)


def episode_metrics(rows: list[dict]) -> dict:
    """KPI по пакету сценариев одной политики на одном экземпляре."""
    profit = np.array([r["profit"] for r in rows]); cash = np.array([r["min_cash"] for r in rows])
    mk = np.array([r["makespan_h"] for r in rows]); tard = np.array([r["tardiness_h"] for r in rows])
    moves = [m["kind"] for r in rows for m in r.get("moves", [])]
    kinds: dict[str, int] = {}
    for k in moves:
        kinds[k] = kinds.get(k, 0) + 1
    return {
        "n": len(rows),
        "profit_mean": float(profit.mean()), "profit_cvar": cvar_lower(profit, ALPHA_PROFIT),
        "cash_min_cvar": cvar_lower(cash, BETA_CASH), "cash_min_p50": float(np.median(cash)),
        "p_breach": float(np.mean([r["breach"] for r in rows])),
        "makespan_mean_h": float(mk.mean()), "makespan_cvar_h": float(np.sort(mk)[-max(1, int(ALPHA_PROFIT * len(mk))):].mean()),
        "tardiness_mean_h": float(tard.mean()), "otd": float(np.mean([r["otd"] for r in rows])),
        "n_wait_mean": float(np.mean([r["n_wait"] for r in rows])),
        "moves_per_episode": len(moves) / max(1, len(rows)), "move_kinds": kinds,
        "share_episodes_with_moves": float(np.mean([len(r.get("moves", [])) > 0 for r in rows])),
    }


@dataclass(frozen=True)
class EvalSpec:
    n_holdout: int = 200
    holdout_seed: int = 2026102201     # [НОРМ] §10.2а
    valid_seed: int = 777              # валидация для ранней остановки (не holdout)
    weeks: int = 26


def scenario_set(n: int, seed: int, weeks: int, stress: StressSpec | None = None) -> ScenarioSet:
    return ScenarioSet(n, seed, weeks=weeks, stress=stress or StressSpec())
