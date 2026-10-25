"""CR-E1 §13 — проверка генератора событий контрагентов (это НЕ валидация: данных предприятия нет, параметры [К]).

Реализованные частоты против модели, по режимам (режим навязан на весь год, 52 недели; генератор — единственная
реализация C++ maos_env.cp_events, поток [seed, 915, id, kind, entity]):
  - годовые дефолты покупателей и поставщиков: PD_g = 1 − (1 − PD̄)^{m_g}, Σ_g π_g m_g = 1;
  - доля когорт с просрочкой q_g = min(1, q̄·m^q_g); доля дефолтов когорт среди просроченных (1 + D_def/σ_g)^{−α};
  - индекс хвоста задержки α — ОМП по сгруппированным неделям с цензурой (аналог Хилла для ⌈x⌉ и Δ > D_def);
  - парная корреляция дефолтов внутри режима — против ∫φ(z)p(z)²dz однофакторной модели с ρ_w;
  - перебои поставщиков: частота начала на неделю и средняя длительность (справочно).
Ошибка Монте-Карло — по сценариям (общий фактор Z делает события внутри сценария зависимыми): z = (оценка − модель)/SE.
Отдельно — CRN между стадиями: события поставщика для id не зависят от числа покупателей и длины розыгрыша.
"""
from __future__ import annotations

import json
import math

import numpy as np
from scipy import integrate, stats as sps

from rl.eval import cr_e1_stats as st

N_GEN, SEED_GEN, WEEKS = 4000, 20261025, 52
SUPPLIERS = [f"S{j:02d}" for j in range(12)]


def multipliers(pi: list[float], crisis: int, kappa: float) -> list[float]:
    """m_g: кризисный режим в κ раз выше спокойного, Σ π_g m_g = 1."""
    w = [kappa if g == crisis else 1.0 for g in range(len(pi))]
    s = sum(p * x for p, x in zip(pi, w))
    return [x / s for x in w]


def implied_corr(pd: float, rho: float) -> float:
    """Подразумеваемая парная корреляция дефолтов однофакторной гауссовой модели."""
    if rho <= 0 or pd <= 0 or pd >= 1:
        return 0.0
    c = sps.norm.ppf(pd)
    f = lambda z: sps.norm.pdf(z) * sps.norm.cdf((c - math.sqrt(rho) * z) / math.sqrt(1 - rho)) ** 2  # noqa: E731
    p2 = integrate.quad(f, -12, 12, limit=200)[0]
    return (p2 - pd * pd) / (pd * (1 - pd))


def draw_all(me, params: dict, regime: int, path: str) -> list[dict]:
    months = [regime] * 12
    return [json.loads(me.cp_events(json.dumps(params), SEED_GEN, i, months, [0] * 12, WEEKS, SUPPLIERS, float("nan"),
                                     path))["events"] for i in range(N_GEN)]


def zscore(est_per_scen: np.ndarray, model: float) -> dict:
    m, se = float(est_per_scen.mean()), float(est_per_scen.std(ddof=1) / math.sqrt(len(est_per_scen)))
    return {"realized": m, "model": model, "se": se, "z": (m - model) / se if se > 0 else 0.0}


def check_regime(ev: list[dict], p: dict, g: int, rho_w: float) -> dict:
    pi, cr = p["regime_stationary"], p["crisis_regime"]
    m_pd = multipliers(pi, cr, p["regime_mult_pd"])[g]
    m_q = multipliers(pi, cr, p["late_regime_mult"])[g]
    sig = p["late_scale_weeks"] * multipliers(pi, cr, p["late_crisis_scale_mult"])[g]
    alpha, dpd = p["late_tail_alpha"], p["default_dpd_weeks"]
    pd_b = 1 - (1 - p["buyer_pd_annual"]) ** m_pd
    pd_s = 1 - (1 - p["supplier_pd_annual"]) ** m_pd
    bdef = np.array([np.mean([b["default_week"] >= 0 for b in e["buyers"]]) for e in ev])
    sdef = np.array([np.mean([s["default_week"] >= 0 for s in e["suppliers"]]) for e in ev])
    late = np.array([np.mean([d > 0 for b in e["buyers"] for d in b["late"]]) for e in ev])
    delays = np.array([d for e in ev for b in e["buyers"] for d in b["late"] if d > 0])
    cohort_def = np.array([np.mean([d > dpd for b in e["buyers"] for d in b["late"] if d > 0] or [0.0]) for e in ev])
    counts = np.bincount(np.minimum(delays, dpd + 1), minlength=dpd + 2)
    nb = len(ev[0]["buyers"])
    n_def = np.array([sum(b["default_week"] >= 0 for b in e["buyers"]) for e in ev], float)
    p_hat = n_def.sum() / (len(ev) * nb)
    corr_emp = ((np.sum(n_def * (n_def - 1)) / (len(ev) * nb * (nb - 1))) - p_hat ** 2) / (p_hat * (1 - p_hat))
    return {
        "m_pd": m_pd, "buyer_default": zscore(bdef, pd_b), "supplier_default": zscore(sdef, pd_s),
        "late_share": zscore(late, min(1.0, p["late_share"] * m_q)),
        "cohort_default_given_late": zscore(cohort_def, (1 + dpd / sig) ** (-alpha)),
        "tail_alpha": {**st.gpd_alpha_grouped(counts, sig, dpd + 1), "model": alpha, "sigma_g": sig},
        "default_corr": {"empirical": float(corr_emp), "model": implied_corr(pd_b, rho_w), "rho_w": rho_w},
        "outages_per_week": float(np.mean([sum(1 for t, d in enumerate(s["disrupt"]) if d > 0 and (t == 0 or
                                           s["disrupt"][t - 1] != d + 1)) / WEEKS for e in ev for s in e["suppliers"]])),
    }


def crn_cross_stage(me, params: dict, path: str) -> dict:
    """Стадия 2 (10 покупателей, 29 недель) и Стадия 1 (без покупателей, 52 недели): события поставщиков сценария id
    совпадают на общем префиксе недель (координатная привязка [seed, 915, id, kind, entity])."""
    months, bad = [0] * 6 + [1] * 6, 0
    for i in range(200):
        a = json.loads(me.cp_events(json.dumps(params), SEED_GEN, i, months, [0] * 12, 29, SUPPLIERS, float("nan"), path))
        b = json.loads(me.cp_events(json.dumps({**params, "buyers_n": 1}), SEED_GEN, i, months, [0] * 12, 52, SUPPLIERS,
                                    float("nan"), path))
        for sa, sb in zip(a["events"]["suppliers"], b["events"]["suppliers"]):
            same_def = sa["default_week"] == sb["default_week"] or (sa["default_week"] < 0 and sb["default_week"] >= 29)
            if not same_def or sa["disrupt"][:20] != sb["disrupt"][:20]:
                bad += 1
    return {"scenarios": 200, "suppliers": len(SUPPLIERS), "mismatches": bad}


def stage_gencheck(rho_w: float) -> dict:
    from rl.env.core import load_module
    from rl.macro.sample import PARAMS_PATH
    me, path = load_module(), str(PARAMS_PATH)
    params = {"enabled": True}
    p = json.loads(me.cp_events(json.dumps(params), SEED_GEN, 0, [0] * 12, [0] * 12, 4, [], float("nan"), path))["params"]
    rep = {"n_scenarios": N_GEN, "weeks": WEEKS, "seed": SEED_GEN, "params": p}
    for g, name in ((0, "calm"), (p["crisis_regime"], "crisis")):
        rep[name] = check_regime(draw_all(me, params, g, path), p, g, rho_w)
    rep["crn_cross_stage"] = crn_cross_stage(me, params, path)
    return rep
