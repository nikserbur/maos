"""Сэмплер по сохранённым параметрам: детерминизм по seed, независимость пути id от n и пакета,
среднее путей → аналитическое условное ожидание (§2.6а тесты а–б), меню стрессов §2.6б."""
import numpy as np
import pytest

from rl.macro import learning as le
from rl.macro.anchored import export_params, observations
from rl.macro.sample import Sampler
from rl.macro.tests.test_recovery import synthetic_var


@pytest.fixture(scope="module")
def sampler():
    """Параметры из синтетической истории (только для теста сэмплера, не для обучения)."""
    import pandas as pd
    z = synthetic_var(n=160, seed=11, sigma=0.8)
    f = pd.DataFrame({"month": [str(pd.Period("2013-09", freq="M") + i) for i in range(160)],
                      "cpi_yoy_pp": 6 + z[:, 0], "key_end_pp": 10 + z[:, 1] + z[:, 0],
                      "usd_rub_end": 60 * np.exp((z[:, 2] + 0.3 * np.arange(160)) / 100)})
    a, trend = observations(f)
    m = le.model(a, 2)
    choice = {"regimes": 2, "block_months": 4, "joint_standardized_CRPS_13months": 0.0}
    p = export_params(m, trend, 4, choice, [choice], f, {"sigma_bb": {"fx_pct_log": 2.0}}, {})
    return Sampler(p)


def test_same_seed_gives_identical_paths(sampler):
    a = sampler.sample(4, 123, horizon_weeks=20)
    b = sampler.sample(4, 123, horizon_weeks=20)
    assert np.array_equal(a["z"], b["z"]) and np.array_equal(a["regime"], b["regime"])
    assert np.array_equal(a["weekly"]["fx"], b["weekly"]["fx"])
    c = sampler.sample(4, 124, horizon_weeks=20)
    assert not np.array_equal(a["z"], c["z"])


def test_path_id_independent_of_batch_size_and_start_index(sampler):
    full = sampler.sample(6, 9, horizon_months=10)
    part = sampler.sample(2, 9, horizon_months=10, start_index=3)
    assert np.array_equal(full["z"][3:5], part["z"])
    assert np.array_equal(full["block_id"][3:5], part["block_id"])
    wk_full = sampler.sample(6, 9, horizon_weeks=12)["weekly"]["fx"]
    wk_part = sampler.sample(1, 9, horizon_weeks=12, start_index=4)["weekly"]["fx"]
    assert np.array_equal(wk_full[4:5], wk_part)


def test_mean_of_paths_converges_to_exact_conditional_expectation(sampler):
    H, n = 6, 6000
    r = sampler.sample_months(n, H, 2026)
    Ez = np.asarray(sampler.expected_path(H))
    mc = r["z"].mean(0)
    se = r["z"].std(0, ddof=1) / np.sqrt(n)
    assert np.all(np.abs(mc - Ez) < 4.5 * se + 1e-9)


def test_pool_means_match_numpy_reference(sampler):
    """Чистая арифметика сэмплера ≡ эталон RJMF `conditional_log_path` с допуском округления."""
    p = sampler.p
    m = {"resid": np.asarray(p["resid"]), "A": np.asarray(p["A"]), "sd": np.asarray(p["sd"]), "mean": np.asarray(p["mean"]),
         "last": np.asarray(p["last"]), "hmm": {"k": p["hmm"]["k"], "P": np.asarray(p["hmm"]["P"]),
                                                "filtered": np.eye(p["hmm"]["k"])[p["hmm"]["labels"]]}}
    m["hmm"]["filtered"][-1] = np.asarray(p["hmm"]["filtered_last"])
    ref = le.conditional_log_path(m, 9, p["block"])
    assert np.allclose(np.asarray(sampler.expected_path(9)), ref, rtol=0, atol=1e-10)


def test_regime_forced_and_quantile_and_episode_stresses(sampler):
    forced = sampler.sample_months(3, 8, 5, stress={"regime": 1})
    assert np.all(forced["regime"] == 1)
    q = sampler.sample(3, 5, horizon_months=8, stress={"quantile_t": 0.95})
    assert np.array_equal(q["z"][0], q["z"][2]) and np.all(q["regime"] == -2)
    base = sampler.sample(3, 5, horizon_months=8)
    assert np.all(q["monthly"]["cpi"][:, -1] > base["monthly"]["cpi"].mean())
    ep = sampler.sample_months(2, 8, 5, stress={"episode": "2015-01", "months": 12})
    hist = sampler.p["history"]["month"]
    lo = hist.index("2015-01") - 1
    assert np.all((ep["block_id"] >= lo) & (ep["block_id"] < lo + 12))
    with pytest.raises(ValueError):
        sampler.sample_months(1, 4, 5, stress={"regime": 7})
    with pytest.raises(ValueError):
        sampler.sample_months(1, 4, 5, stress={"quantile_t": 0.123})


def test_weekly_mapping_interpolates_months_and_steps_key_rate(sampler):
    r = sampler.sample(2, 3, horizon_weeks=26, bridge=False)
    wk, mo = r["weekly"], r["monthly"]
    last = sampler.p["last_obs"]
    # Неделя 4 (τ = 60/52 ≈ 1.15): ставка = месяц 1; недели 0–3 — текущая ставка (ступень).
    assert np.all(wk["key"][:, 0] == last["key_pp"]) and np.all(wk["key"][:, 4] == mo["key"][:, 0])
    # Инфляция и курс (без моста) — на отрезке между соседними месяцами.
    for i in range(2):
        lo_, hi_ = sorted([last["cpi_yoy_pp"], mo["cpi"][i, 0]])
        assert lo_ - 1e-9 <= wk["cpi"][i, 0] <= hi_ + 1e-9
        lo_, hi_ = sorted([last["usd_rub"], mo["fx"][i, 0]])
        assert lo_ - 1e-9 <= wk["fx"][i, 0] <= hi_ + 1e-9
    with_bridge = sampler.sample(2, 3, horizon_weeks=26)["weekly"]["fx"]
    assert not np.array_equal(with_bridge, wk["fx"]) and np.allclose(with_bridge[:, 12], wk["fx"][:, 12])  # τ=3 → мост = 0
