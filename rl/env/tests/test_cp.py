"""T23 — блок контрагентского риска (CPR) в сценариях стенда: rl.cp.enabled = 0 не меняет JSON сценариев
(эталонные хеши сняты до изменений), при 1 события поэлементно равны maos_env.cp_events (генератор C++),
legacy-дефолт [seed, 911] не применяется, SimEnv принимает сценарий."""
import hashlib
import json

from rl.env.core import load_module, make_env
from rl.env.scenarios import CP_WEEKS_MIN, STRESSES, ScenarioSet

# sha256 JSON 24 сценариев (seed 20261025, 26 недель) — снято бинарём/кодом до изменений CPR.
GOLDEN = {
    "base": "9612188d261f8b26712a3362c00f2aed7576bf391a4c9893e5835665b8daa97e",
    "shock": "ff1a73abf13ed16a1908621665b69c2a955e5bdbd73b2958417c13d83ab0677c",
    "crisis": "fb536b8af1c8b8095194980364bca05f5ad5a4461fd3127dc6b15bbe1045d230",
}

SMALL = {
    "name": "cp-small",
    "wc_types": [{"id": "A"}, {"id": "B"}],
    "machines": [{"id": "a1", "wct": "A"}, {"id": "b1", "wct": "B"}],
    "products": [
        {"id": "P", "batch_size": 1, "ops": [{"id": "op1", "wc_types": ["B"], "t_exp": 90, "sigma": 9, "inputs": [["Q", 1.0]]}]},
        {"id": "Q", "batch_size": 1, "purchased": True, "stock": 0, "lead_hours": 200, "base_cost": 30},
    ],
    "workers": [],
    "orders": [{"product_id": "P", "qty": 4, "due_h": 500, "price": 1000, "mat_cost": 30}],
    "fin": {"c0": 5000, "credit_limit": 5000},
    "tail_weight": 0.0,
}


def _hash(ss: ScenarioSet, n: int) -> str:
    h = hashlib.sha256()
    for i in range(n):
        h.update(ss.scenario_json(i).encode())
    return h.hexdigest()


def test_cp_disabled_keeps_scenarios_bit_identical():
    for name, digest in GOLDEN.items():
        ss = ScenarioSet(n=24, seed=20261025, weeks=26, stress=STRESSES[name])
        assert _hash(ss, 24) == digest, name


def test_cp_enabled_events_equal_cpp_generator():
    me = load_module()
    ss = ScenarioSet(n=6, seed=42, weeks=26, cp_enabled=True, cp_params={"late_share": 0.3}, cp_suppliers=("Q",))
    for i in range(6):
        sc = ss.scenario(i)
        assert sc["default_week"] == -1 and sc["lgd"] == 0.0      # без двойного счёта с legacy [seed, 911]
        p = ss._paths
        ref = json.loads(me.cp_events(json.dumps({"late_share": 0.3, "enabled": True}), 42, i,
                                      [int(x) for x in p["regime_m"][i]], [int(x) for x in p["block_m"][i]],
                                      CP_WEEKS_MIN, ["Q"], 0.0, str(ss.params_path)))
        assert sc["cp"] == ref
        assert len(sc["cp"]["events"]["buyers"]) == 10 and len(sc["cp"]["events"]["suppliers"]) == 1
    # События сценария i не зависят от размера набора (CRN по индексу).
    big = ScenarioSet(n=12, seed=42, weeks=26, cp_enabled=True, cp_params={"late_share": 0.3}, cp_suppliers=("Q",))
    assert big.scenario(3)["cp"] == ss.scenario(3)["cp"]


def test_cp_scenario_runs_in_simenv():
    me = load_module()
    env = make_env(me.Instance.from_json(json.dumps(SMALL)), {"event_mode": False})
    ss = ScenarioSet(n=4, seed=7, weeks=26, cp_enabled=True, cp_params={"buyer_pd_annual": 0.9, "late_share": 0.5},
                     cp_suppliers=("Q",))
    seen = 0
    for i in range(4):
        env.reset(100 + i, ss.scenario_json(i))
        while not env.done:
            if env.level == 2:
                env.step(0)
            else:
                env.step_job(env.rule_choice("EDD"))
        s = json.loads(env.summary())
        assert s["counterparty"] is not None
        assert s["cash_residual"] <= 1e-6 * 1e5
        seen += s["counterparty"]["bad_debt"] > 0
    assert seen > 0


def test_cp_crisis_splice_and_joint_default():
    """Сплайс кризиса A2: события CPR — на режимах с кризисом с месяца ⌊12w/52⌋ (CRN-двойник — без сплайса);
    стресс «joint»: дефолт крупнейшего покупателя не позже недели legacy-розыгрыша (0-based)."""
    import math
    me = load_module()
    ss = ScenarioSet(n=24, seed=20261025, weeks=26, stress=STRESSES["shock"], cp_enabled=True, cp_suppliers=("Q",))
    p = ss._paths
    spliced = [i for i in range(24) if ss._shocks[i] and "_splice" in ss._shocks[i]]
    assert spliced, "нет сценария с переключением в кризис"
    for i in spliced[:3]:
        w = ss._shocks[i]["regime_shock_week"]
        m0 = int(math.floor(12.0 * w / 52.0))
        reg = [int(x) for x in p["regime_m"][i]]
        reg = reg[:m0] + [int(p["crisis"])] * (len(reg) - m0)
        ref = json.loads(me.cp_events(json.dumps({"enabled": True}), 20261025, i, reg, [int(x) for x in p["block_m"][i]],
                                      CP_WEEKS_MIN, ["Q"], float("nan"), str(ss.params_path)))
        assert ss.scenario(i)["cp"] == ref
        assert json.loads(ss.twin_json(i))["cp"] == ss.cp_events(i)          # двойник — исходный режимный путь
    joint = ScenarioSet(n=8, seed=11, weeks=26, stress=STRESSES["joint"], cp_enabled=True,
                        cp_params={"buyer_shares": [0.2, 0.5, 0.3]})
    for i in range(8):
        sc = joint.scenario(i)
        dw = sc["cp"]["events"]["buyers"][1]["default_week"]
        assert 0 <= dw <= int(joint._paths["dweek"][i]) - 1
        assert sc["default_week"] == -1                                      # legacy-дефолт не применяется


def test_cp_events_rejects_invalid_params():
    import pytest
    me = load_module()
    for bad in ({"rho": 5}, {"late_max_weeks": 40}, {"crisis_regime": 9}):
        with pytest.raises(ValueError):
            me.cp_events(json.dumps(bad), 1, 0)
