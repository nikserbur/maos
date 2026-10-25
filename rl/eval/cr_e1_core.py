"""CR-E1 — эффект контрагентского риска на ТОТ ЖЕ план: стенд, тела запросов, контрасты (раннер — rl/eval/cr_e1.py;
предрегистрация и отчёт — docs/research/K1-counterparty-risk.md).

Стенд: отдельные экземпляры maos_server на копиях демо-БД (127.0.0.1:8091…), общий сервер 8080 и fin_params не
трогаются — все переопределения идут полями запроса fin_override и counterparty. Сырые массивы по сценариям —
только на диске (raw/*.json, как для A1–A4); сводка — summary.json и summary.md.

Плечи (одни CRN; события контрагентов зависят только от (seed, id) — поток [seed, 915]):
  A0 — без контрагентского риска (fin.cp.enabled = 0, fin.pd = 0);
  A1 — текущий продукт (enabled = 0, legacy fin.pd = 0.02, LGD 0.45, поток [seed, 911]);
  A2 — CPR с умолчаниями паспорта (enabled = 1).
Режимы: base (MacroSampler base) и crisis (режим навязан: regime = crisis_index = 1).
"""
from __future__ import annotations

import json
import queue
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import requests

from rl.eval import cr_e1_stats as st

SEED, SEED_REP, SEED_VSS_SHIFT = 42, 4242, 9973
N_WF, N_PLAN, N_LP, N_REP, REP_SEEDS = 2000, 1000, 1000, 300, list(range(101, 111))
BETA, ALPHA, B_BOOT = 0.05, 0.10, 2000
H26 = {"horizon_hours": 4368, "horizon_weeks": 26}       # §4.1, H_P = 26 [К]
H5 = {"horizon_hours": 720, "horizon_weeks": 5}          # штатный горизонт (преемственность с M1 и брифом)
REGIMES = {"base": {}, "crisis": {"macro_stress": {"regime": 1}}}
ZERO_CP = {"buyer_pd_annual": 0, "late_share": 0, "supplier_pd_annual": 0, "disrupt_share": 0}
ARMS = {
    "A0": {"fin_override": {"pd": 0}, "counterparty": {"enabled": False}},
    "A1": {"counterparty": {"enabled": False}},
    "A2": {"counterparty": {"enabled": True}},
    "A0z": {"fin_override": {"pd": 0}, "counterparty": {"enabled": True, **ZERO_CP}},   # = A0 (гейт в); для d_φ
}
ABLATION = {   # только один канал CPR (остальные вероятности обнулены); «всё» — само A2
    "only_late": {"buyer_pd_annual": 0, "supplier_pd_annual": 0, "disrupt_share": 0},
    "only_buyer_default": {"late_share": 0, "supplier_pd_annual": 0, "disrupt_share": 0},
    "only_supplier_default": {"buyer_pd_annual": 0, "late_share": 0, "disrupt_share": 0},
    "only_disrupt": {"buyer_pd_annual": 0, "late_share": 0, "supplier_pd_annual": 0},
}
SENS = {   # §14: торнадо (A2 − A0, base); значения по умолчанию паспорта не повторяются
    "pd_x0.5": {"buyer_pd_annual": 0.02}, "pd_x2": {"buyer_pd_annual": 0.08},
    "lgd_0.45": {"buyer_lgd": 0.45, "supplier_lgd": 0.45},
    "kappa_pd_1": {"regime_mult_pd": 1}, "kappa_pd_2": {"regime_mult_pd": 2}, "kappa_pd_5": {"regime_mult_pd": 5},
    "rho_0": {"rho": 0}, "rho_0.136": {"rho": 0.136}, "rho_0.3": {"rho": 0.3},
    "lambda_f_0.5": {"lambda_f": 0.5},
    "late_0.05": {"late_share": 0.05}, "late_0.3": {"late_share": 0.3},
    "alpha_1.2": {"late_tail_alpha": 1.2}, "alpha_2.5": {"late_tail_alpha": 2.5},
    "conc_5_1.5": {"buyers_n": 5, "buyers_zipf": 1.5}, "conc_30_0.5": {"buyers_n": 30, "buyers_zipf": 0.5},
    "spd_x0.5": {"supplier_pd_annual": 0.02}, "spd_x2": {"supplier_pd_annual": 0.08},
    "pi_rep_0.05": {"supplier_replace_premium": 0.05}, "pi_rep_0.2": {"supplier_replace_premium": 0.2},
    "lr_26": {"recovery_lag_weeks": 26},
}
LOGIN = {"login": "admin", "password": "maos2025"}   # локальный стенд (постановка)


# ── Стенд ───────────────────────────────────────────────────────────────────────────────────────────────
class Stand:
    """Пул серверов: каждый запрос берёт свободный порт (HiGHS сериализован внутри процесса — параллельно по
    процессам); ответы кэшируются в raw/<key>.json (повторный запуск пропускает готовое)."""

    def __init__(self, ports: list[int], raw: Path):
        self.raw = raw
        raw.mkdir(parents=True, exist_ok=True)
        self.tokens = {p: self._login(p) for p in ports}
        self.free: queue.Queue[int] = queue.Queue()
        for p in ports:
            self.free.put(p)
        self.lock = threading.Lock()

    @staticmethod
    def _login(port: int) -> str:
        r = requests.post(f"http://127.0.0.1:{port}/api/auth/login", json=LOGIN, timeout=30)
        return r.json()["data"]["token"]

    def call(self, key: str, path: str, body: dict, port: int | None = None) -> dict:
        f = self.raw / f"{key}.json"
        if f.exists():
            return json.loads(f.read_text())
        p = port if port is not None else self.free.get()
        try:
            t0 = time.time()
            r = requests.post(f"http://127.0.0.1:{p}{path}", json=body, timeout=24 * 3600,
                              headers={"Authorization": f"Bearer {self.tokens[p]}"})
            js = r.json()
            if js.get("error") or "data" not in js:
                raise RuntimeError(f"{key}: {js.get('error')}")
            out = {"key": key, "port": p, "wall_s": time.time() - t0, "request": body, "data": js["data"]}
        finally:
            if port is None:
                self.free.put(p)
        f.write_text(json.dumps(out, ensure_ascii=False))
        return out

    def many(self, jobs: list[tuple[str, str, dict]], workers: int) -> dict[str, dict]:
        with ThreadPoolExecutor(max_workers=workers) as ex:
            futs = {k: ex.submit(self.call, k, path, body) for k, path, body in jobs}
            return {k: fu.result() for k, fu in futs.items()}


def merge(*parts: dict) -> dict:
    """Слияние тел запроса (вложенные fin_override/counterparty сливаются, не заменяются)."""
    out: dict = {}
    for p in parts:
        for k, v in p.items():
            out[k] = {**out.get(k, {}), **v} if isinstance(v, dict) and k in ("fin_override", "counterparty") else v
    return out


def eval_body(plan: dict, arm: str, regime: str, seed: int, n: int, hz: dict, *extra: dict) -> dict:
    base = {"cash": True, "objective": "cvar", "beta": BETA, "l_min": 0, "financing_stage": "recourse",
            "seed": seed, "samples": n, "cash_samples": n, "pol_curve": False, "eval_portfolio": plan, **hz}
    return merge(base, REGIMES[regime], ARMS[arm], *extra)


# ── Извлечение пер-сценарных массивов ───────────────────────────────────────────────────────────────────
def arrays(res: dict) -> dict[str, np.ndarray]:
    ps = res["data"]["cash_lp"]["fixed_portfolio"]["per_scenario"]
    out = {k: np.asarray(ps[k], float) for k in ("profit", "min_cash", "breach", "interest", "covenant", "max_debt")}
    out["dscr"] = np.asarray([np.inf if v is None else v for v in ps["dscr"]], float)
    out["t_breach"] = np.asarray(ps["t_breach"], float)
    cp = ps.get("counterparty") or {}
    for k in ("bad_debt", "supplier_loss", "recoveries", "ship_delay"):
        out[k] = np.asarray(cp.get(k, np.zeros(len(out["profit"]))), float)
    return out


def wf_summary(res: dict) -> dict:
    return res["data"]["cash_lp"]["fixed_portfolio"]["waterfall_rule"]


def contrast(a: dict, b: dict, idx: np.ndarray, bca: bool = False) -> dict:
    """Первичные (ΔCVaR_β(C_min), ΔP(разрыв)) и вторичные исходы контраста a − b на одних сценариях."""
    dscr_a, dscr_b = np.minimum(a["dscr"], 1e12), np.minimum(b["dscr"], 1e12)
    tb = {k: (np.percentile(x["t_breach"][x["t_breach"] > 0], 10) if np.any(x["t_breach"] > 0) else None)
          for k, x in (("a", a), ("b", b))}
    return {
        "P1_cvar_cmin": st.delta_cvar(a["min_cash"], b["min_cash"], BETA, idx, bca=bca),
        "P2_breach": st.newcombe10(a["breach"], b["breach"]),
        "E_profit": st.delta_mean(a["profit"], b["profit"], idx),
        "cvar_profit": st.delta_cvar(a["profit"], b["profit"], ALPHA, idx),
        "q05_dscr": st.delta_quantile(dscr_a, dscr_b, 0.05, idx),
        "p_covenant": st.newcombe10(a["covenant"], b["covenant"]),
        "max_debt_mean": st.delta_mean(a["max_debt"], b["max_debt"], idx),
        "max_debt_q95": st.delta_quantile(a["max_debt"], b["max_debt"], 0.95, idx),
        "interest": st.delta_mean(a["interest"], b["interest"], idx),
        "t_breach_p10": tb,
    }


def p1p2_only(a: dict, b: dict, idx: np.ndarray) -> dict:
    return {"P1_cvar_cmin": st.delta_cvar(a["min_cash"], b["min_cash"], BETA, idx),
            "P2_breach": st.newcombe10(a["breach"], b["breach"]),
            "E_profit": st.delta_mean(a["profit"], b["profit"], idx)}


def did(a2b: dict, a0b: dict, a2c: dict, a0c: dict, idx: np.ndarray) -> dict:
    """DiD = Δ_crisis − Δ_base (совместный бутстреп по id: одни индексы для четырёх массивов)."""
    out = {}
    for name, key, beta in (("cvar_cmin", "min_cash", BETA), ("cvar_profit", "profit", ALPHA)):
        db = st.boot_cvar_delta_samples(a2b[key], a0b[key], beta, idx)
        dc = st.boot_cvar_delta_samples(a2c[key], a0c[key], beta, idx)
        pt = (st.cvar_lower(a2c[key], beta) - st.cvar_lower(a0c[key], beta)) - \
             (st.cvar_lower(a2b[key], beta) - st.cvar_lower(a0b[key], beta))
        boot = dc - db
        out[name] = {"did": pt, "ci": [float(np.quantile(boot, .025)), float(np.quantile(boot, .975))]}
    bb = a2b["breach"][idx].mean(1) - a0b["breach"][idx].mean(1)
    bc = a2c["breach"][idx].mean(1) - a0c["breach"][idx].mean(1)
    pt = (a2c["breach"].mean() - a0c["breach"].mean()) - (a2b["breach"].mean() - a0b["breach"].mean())
    out["p_breach"] = {"did": float(pt), "ci": [float(np.quantile(bc - bb, .025)), float(np.quantile(bc - bb, .975))]}
    return out


def cp_block(res: dict) -> dict:
    cp = res["data"]["cash_lp"].get("counterparty") or {}
    keys = ("p_buyer_default", "p_supplier_default", "mean_buyer_defaults", "mean_supplier_defaults",
            "ecl_pct_revenue", "bad_debt_mean", "supplier_loss_mean", "recoveries_mean", "discount_mean",
            "late_share_by_regime", "cohort_default_share", "default_corr", "supply", "warnings", "param_status")
    return {k: cp.get(k) for k in keys if k in cp}
