"""Восстановление параметров на синтетике с известной истиной — единственное законное
применение синтетических данных (METHODOLOGY-V2 §11.5). Эти данные не попадают в обучение."""
import numpy as np

from rl.macro import learning as le

A_TRUE = np.array([[0.7, 0.1, 0.0],
                   [0.05, 0.6, 0.1],
                   [0.0, 0.15, 0.8]])


def synthetic_var(n=3000, seed=3, sigma=1.0):
    rng = np.random.default_rng(seed)
    z = np.zeros((n, 3))
    for t in range(1, n):
        z[t] = z[t - 1] @ A_TRUE + sigma * rng.standard_normal(3)
    return z


def test_ridge_var_recovers_transition_matrix_on_long_synthetic_series():
    z = synthetic_var()
    m = le.fit_var(z)
    # Стандартизация не меняет A с точностью до масштабов столбцов: сравниваем в единицах данных.
    A_hat = np.diag(1 / m["sd"]) @ m["A"] @ np.diag(m["sd"])
    assert np.max(np.abs(A_hat - A_TRUE)) < 0.05
    assert m["radius_after"] <= le.RADIUS_CAP + 1e-12
    assert m["ridge"] in le.RIDGE_GRID


def test_spectral_radius_is_capped_for_near_unit_root_series():
    rng = np.random.default_rng(1)
    z = np.cumsum(rng.standard_normal((800, 3)), axis=0)       # случайное блуждание → ρ ≈ 1
    m = le.fit_var(z)
    assert m["radius_after"] <= le.RADIUS_CAP + 1e-12


def test_hmm_recovers_two_variance_regimes():
    rng = np.random.default_rng(5)
    n = 1200
    P = np.array([[0.95, 0.05], [0.1, 0.9]])
    state = np.zeros(n, int)
    for t in range(1, n):
        state[t] = state[t - 1] if rng.random() < P[state[t - 1], state[t - 1]] else 1 - state[t - 1]
    scale = np.where(state == 0, 0.5, 3.0)[:, None]
    x = scale * rng.standard_normal((n, 2))
    h = le.fit_hmm(x, 2)
    lab = h["filtered"].argmax(1)
    agree = max(np.mean(lab == state), np.mean(lab != state))          # метки режимов определены с точностью до перестановки
    assert agree > 0.85
    stay = sorted(np.diag(h["P"]))
    assert abs(stay[0] - 0.9) < 0.1 and abs(stay[1] - 0.95) < 0.07


def test_crps_of_point_mass_equals_absolute_error():
    assert abs(le.crps(np.full(50, 2.0), 3.5) - 1.5) < 1e-12
    s = np.random.default_rng(0).standard_normal(4000)
    # CRPS стандартной нормали в 0 = (√2 − 1)/√π ≈ 0.2337
    assert abs(le.crps(s, 0.0) - 0.2337) < 0.02
