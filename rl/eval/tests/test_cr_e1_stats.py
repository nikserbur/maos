"""Статистика CR-E1 (rl/eval/cr_e1_stats.py): эталонные значения и свойства интервалов."""
import math

import numpy as np
import pytest
from scipy import stats as sps

from rl.eval import cr_e1_stats as st


def test_cvar_lower_is_mean_of_k_worst():
    x = np.arange(100, dtype=float)                    # k = ⌊0.05·100⌋ = 5 → среднее 0..4
    assert st.cvar_lower(x, 0.05) == pytest.approx(2.0)
    assert st.cvar_lower(np.array([3.0, 1.0]), 0.05) == 1.0      # k = max(1, 0) = 1
    assert st.cvar_upper(x, 0.10) == pytest.approx(94.5)         # 10 наибольших: 90..99


def test_wilson_reference_values():
    lo, hi = st.wilson(0, 10)
    assert lo == 0.0 and hi == pytest.approx(0.2775, abs=1e-4)   # верхняя граница при k = 0 > 0
    lo, hi = st.wilson(5, 10)
    assert lo == pytest.approx(0.2366, abs=1e-4) and hi == pytest.approx(0.7634, abs=1e-4)


def test_mcnemar_exact_matches_binomial_test():
    for b, c in ((8, 4), (81, 7), (0, 3), (10, 10)):
        ref = sps.binomtest(min(b, c), b + c, 0.5).pvalue if b + c else 1.0
        assert st.mcnemar_exact(b, c) == pytest.approx(min(1.0, ref), rel=1e-9)
    assert st.mcnemar_exact(0, 0) == 1.0


def test_newcombe10_properties():
    rng = np.random.default_rng(1)
    x2 = (rng.random(2000) < 0.02).astype(int)
    x1 = x2.copy()
    x1[rng.choice(2000, 6, replace=False)] = 1          # пары сильно связаны: φ > 0
    r = st.newcombe10(x1, x2)
    assert r["ci"][0] <= r["delta"] <= r["ci"][1]
    assert r["phi"] > 0.5
    # Независимые пары (φ = 0) → интервал разности независимых долей по Уилсону (метод 10 Ньюкомба, 1998).
    ind = st.newcombe10(np.array([1] * 10 + [0] * 30 + [1] * 10 + [0] * 50), np.array([1] * 10 + [0] * 30 + [0] * 10 + [1] * 50))
    l1, u1 = ind["p1_wilson"]
    l2, u2 = ind["p2_wilson"]
    p1, p2 = ind["p1"], ind["p2"]
    assert ind["phi"] == pytest.approx((10 * 30 - 10 * 50) / math.sqrt(20 * 80 * 60 * 40))
    # Совпадающие ряды: Δ = 0, интервал симметричен и не пуст.
    same = st.newcombe10(x2, x2)
    assert same["delta"] == 0 and same["ci"][0] < 0 < same["ci"][1]
    assert same["discordant"] == [0, 0] and same["p_mcnemar"] == 1.0
    assert 0 <= l1 <= p1 <= u1 <= 1 and 0 <= l2 <= p2 <= u2 <= 1


def test_holm_adjustment():
    adj = st.holm({"P1": 0.01, "P2": 0.04})
    assert adj["P1"] == pytest.approx(0.02) and adj["P2"] == pytest.approx(0.04)
    adj = st.holm({"P1": 0.03, "P2": 0.02})
    assert adj["P2"] == pytest.approx(0.04) and adj["P1"] == pytest.approx(0.04)   # монотонность


def test_paired_bootstrap_cvar_shift_and_bca():
    rng = np.random.default_rng(7)
    b = rng.normal(size=1000)
    a = b - 1.0                                         # сдвиг на −1 во всех сценариях → ΔCVaR = −1 точно
    idx = st.boot_indices(1000, 500, 3)
    r = st.delta_cvar(a, b, 0.05, idx, bca=True)
    assert r["delta"] == pytest.approx(-1.0)
    assert r["ci"][0] == pytest.approx(-1.0) and r["ci"][1] == pytest.approx(-1.0)
    assert r["p_boot"] == 0.0


def test_t_interval_nine_degrees_of_freedom():
    d = np.arange(10, dtype=float)
    r = st.t_interval(d)
    half = sps.t.ppf(0.975, 9) * d.std(ddof=1) / math.sqrt(10)
    assert r["df"] == 9 and r["ci"] == pytest.approx([4.5 - half, 4.5 + half])


def test_grouped_tail_mle_recovers_alpha():
    rng = np.random.default_rng(11)
    alpha, sigma, cap = 1.5, 3.0, 14
    x = sigma * ((1 - rng.random(200_000)) ** (-1 / alpha) - 1)
    w = np.minimum(np.maximum(1, np.ceil(x)), cap).astype(int)     # ⌈x⌉, цензура Δ ≥ cap
    r = st.gpd_alpha_grouped(np.bincount(w, minlength=cap + 1), sigma, cap)
    assert abs(r["alpha_hat"] - alpha) < 4 * r["se"]
