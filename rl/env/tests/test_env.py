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


def test_l0_rule_env_constant_policy_equals_rule(inst, me):
    """L0 «выбор правила» (A2): политика «всегда r» воспроизводит правило r в событийном режиме (CRN)."""
    from rl.env.l0_env import RULES, L0RuleEnv
    for r_idx, rule in enumerate(RULES):
        env = L0RuleEnv([inst], {"breakdowns": True, "event_mode": True}, None, seed_base=5)
        obs, _ = env.reset(options={"instance": 0, "scenario": 3})
        assert env.action_masks()[:len(RULES)].all() and not env.action_masks()[len(RULES)]   # CP-SAT: нет ключа
        assert env.action_space.n == len(RULES) + 3
        done = False
        while not done:
            obs, _, done, _, info = env.step(r_idx)
        ref = me.SimEnv(inst, make_config({"breakdowns": True, "event_mode": True}))
        want = run_rule(ref, rule, 5 + 3)
        assert info["summary"]["makespan_h"] == pytest.approx(want["makespan_h"])
        assert info["summary"]["profit"] == pytest.approx(want["profit"])


def test_l0_rule_env_default_and_cpsat_actions(inst, me):
    """Действие 8 = статический чемпион экземпляра; 7 = очередь по ключу CP-SAT (= evaluate_key)."""
    from rl.env.l0_env import L0RuleEnv
    env0 = me.SimEnv(inst, make_config({"breakdowns": True}))
    env0.reset(1)
    key = [float(-i) for i in range(env0.n_jobs)]
    for action, want in ((8, ("rule", "SPT")), (7, ("key", key))):
        env = L0RuleEnv([inst], {"breakdowns": True}, None, seed_base=5, defaults=[1], cp_keys=[key])
        env.reset(options={"instance": 0, "scenario": 2})
        done = False
        while not done:
            _, _, done, _, info = env.step(action)
        ref = me.SimEnv(inst, make_config({"breakdowns": True}))
        got = run_rule(ref, want[1], 7) if want[0] == "rule" else json.loads(me.evaluate_key(ref, want[1], 7))
        assert info["summary"]["profit"] == pytest.approx(got["profit"])
        assert info["summary"]["makespan_h"] == pytest.approx(got["makespan_h"])


def test_shock_scenarios_crn_and_twin(inst, me):
    """Стресс «шок»: ≥ 1 событие в сценарии, детерминизм по индексу; двойник — без событий."""
    from rl.env.scenarios import STRESSES, ScenarioSet
    a, b = ScenarioSet(6, 11, stress=STRESSES["shock"]), ScenarioSet(6, 11, stress=STRESSES["shock"])
    for i in range(6):
        assert a.has_shock(i) and a.scenario_json(i) == b.scenario_json(i)
        tw = json.loads(a.twin_json(i))
        assert "outage_at" not in tw and "rush_at" not in tw and "supply_delay" not in tw
    env = me.SimEnv(inst, make_config({"breakdowns": True}))
    seen = 0
    for i in range(6):           # срыв поставки на этом экземпляре не действует (нет покупных входов)
        sc = json.loads(a.scenario_json(i))
        s = json.loads(me.evaluate_rule(env, "EDD", 3, a.scenario_json(i)))
        if "outage_at" in sc or "rush_at" in sc or "regime_shock_week" in sc:
            assert s["shock"]["has_shock"]; seen += 1
    assert seen > 0
