"""Smoke-тесты обёрток SimEnv: reset/step/mask, правила, ГА, сценарии CRN."""
import json

import numpy as np
import pytest

from rl.env.core import load_module, make_config, make_env, run_rule

SMALL = {
    "name": "small",
    "wc_types": [{"id": "A"}, {"id": "B"}],
    "machines": [{"id": "a1", "wct": "A"}, {"id": "a2", "wct": "A"}, {"id": "b1", "wct": "B"}],
    "products": [
        {"id": "S", "batch_size": 1, "ops": [{"id": "os", "wc_types": ["A"], "t_exp": 60, "sigma": 6, "inputs": []}]},
        {"id": "P", "batch_size": 2, "ops": [
            {"id": "op1", "wc_types": ["A", "B"], "t_exp": 90, "sigma": 9, "setup": 15, "inputs": [["S", 1.0]]},
            {"id": "op2", "wc_types": ["B"], "t_exp": 45, "sigma": 4, "inputs": []}]},
    ],
    "workers": [{"id": "w1", "skills": []}],
    "orders": [{"product_id": "P", "qty": 4, "due_h": 40, "price": 1000, "mat_cost": 100},
               {"product_id": "P", "qty": 2, "due_h": 60, "price": 500, "mat_cost": 100},
               {"product_id": "S", "qty": 3, "due_h": 30, "price": 200, "mat_cost": 10}],
    "outsource": {"lead_h": 48, "markup": 1.3, "prepay": 0.5},
    "fin": {"c0": 1000, "credit_limit": 5000},
    "tail_weight": 0.05,
}


@pytest.fixture(scope="module")
def me():
    return load_module()


@pytest.fixture
def inst(me):
    return me.Instance.from_json(json.dumps(SMALL))


def test_l0_reset_step_mask(inst):
    from rl.env.l0_env import L0Env
    env = L0Env([inst], {"breakdowns": True}, seed_base=1)
    obs, info = env.reset(seed=3)
    assert obs.shape == (env.cur.obs_l0_size,)
    total, steps = 0.0, 0
    done = False
    while not done:
        mask = env.action_masks()
        assert mask.any()
        a = int(np.flatnonzero(mask)[0])
        obs, r, done, trunc, info = env.step(a)
        total += r; steps += 1
        assert steps < 10000
    assert "summary" in info and info["summary"]["done"]
    assert info["summary"]["n_decisions"] == steps


def test_rule_slot_and_wait_mask(inst):
    env = make_env(inst, {"breakdowns": False})
    env.reset(5)
    slot = env.rule_slot("EDD")
    assert 0 <= slot <= env.act_l0_size - 1
    assert env.mask_l0()[slot] == 1
    # WAIT недопустим в самом начале (нет ожидаемых событий)
    assert env.mask_l0()[env.act_l0_size - 1] == 0


def test_crn_same_seed_same_result(inst):
    a = make_env(inst, {}); b = make_env(inst, {})
    ra, rb = run_rule(a, "SPT", 11), run_rule(b, "SPT", 11)
    assert ra["makespan_h"] == rb["makespan_h"] and ra["profit"] == rb["profit"]


def test_l2_env_moves(inst):
    from rl.env.l2_env import L2Env
    env = L2Env([inst], {"breakdowns": False}, seed_base=2, l0_policy="rule:EDD")
    obs, _ = env.reset(seed=1)
    assert obs.shape == (env.cur.obs_l2_size,)
    mask = env.action_masks()
    assert mask[0]
    K = env.cur.act_l2_size
    # первый допустимый не-noop ход
    cand = [a for a in range(1, K) if mask[a]]
    assert cand, "ожидались допустимые ходы на неделе 0"
    obs, r, done, _, info = env.step(cand[0])
    while not done:
        obs, r, done, _, info = env.step(0)
    assert info["summary"]["n_moves"] >= 1


def test_ga_improve_runs(me, inst):
    env = make_env(inst, {"event_mode": False, "deterministic": True, "breakdowns": False})
    ga = json.loads(me.ga_improve(env, 3, 1, 1, 5.0, ["EDD", "SPT"]))
    assert ga["best_score"] <= ga["seed_score"] + 1e-9
    assert len(ga["best_key"]) == env.n_jobs


def test_scenario_set_crn():
    from rl.env.scenarios import ScenarioSet, STRESSES
    s1 = ScenarioSet(4, 7, weeks=8)
    s2 = ScenarioSet(4, 7, weeks=8)
    assert s1.scenario(2) == s2.scenario(2)
    assert len(s1.scenario(0)["key_rate"]) == 8
    cr = ScenarioSet(2, 7, weeks=8, stress=STRESSES["crisis"])
    assert len(set(cr.scenario(0)["regime"])) == 1
    jt = ScenarioSet(2, 7, weeks=8, stress=STRESSES["joint"])
    assert jt.scenario(0)["default_week"] > 0 and jt.scenario(0)["lead_mul"] == 2.0
