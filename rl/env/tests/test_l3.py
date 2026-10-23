"""A3: структурный режим SimEnv из Python — noop совпадает с правилом (CRN), Gymnasium-обёртка, оценка инвестпроекта."""
import json

import numpy as np

from rl.env.core import load_module, make_config
from rl.env.l3_env import A, N_ACT, N_OBS, StructEnv, run_struct
from rl.env.scenarios import STRESSES, ScenarioSet


def _inst(qty: float = 50.0, capex: float = 5e5):
    cal = [[[360, 1320]] if d < 5 else [] for d in range(7)]
    ops = [{"id": "p1", "name": "p1", "wc_types": ["A"], "t_exp": 60, "sigma": 6, "hour_rate": 1000, "inputs": []},
           {"id": "p2", "name": "p2", "wc_types": ["B"], "t_exp": 120, "sigma": 12, "hour_rate": 2000, "inputs": []}]
    orders = [{"product_id": "P", "qty": qty, "release_h": 168.0 * k, "due_h": 168.0 * (k + 1.5), "price": 4000, "mat_cost": 500}
              for k in range(6)]
    js = {"name": "t", "wc_types": [{"id": "A"}, {"id": "B", "mtbf": 200, "repair_h": 6}],
          "machines": [{"id": "a1", "wct": "A"}, {"id": "a2", "wct": "A"}, {"id": "b1", "wct": "B"}],
          "products": [{"id": "P", "batch_size": 1, "ops": ops}], "workers": [], "orders": orders,
          "calendar": {"any": True, "days": cal}, "outsource": {"lead_h": 24}, "fin": {"c0": 2e6, "credit_limit": 5e6, "tax_cumulative": True},
          "tail_weight": 0.0,
          "a3": {"late_fixed": 0.05, "late_per_week": 0.05, "late_cap": 0.5, "invest_cands": [
              {"id": "mB", "kind": "machine", "wct": "B", "capex": capex, "lead_weeks": 2, "opex_weekly": 0.001 * capex}]}}
    return load_module().Instance.from_json(json.dumps(js))


def test_struct_noop_equals_rule_and_invest_moves():
    me = load_module()
    sc = ScenarioSet(4, 777, stress=STRESSES["shock"])
    plain = me.SimEnv(_inst(), make_config({"dense_reward": False}))
    base = [json.loads(me.evaluate_rule(plain, "SPT", 10 + i, sc.scenario_json(i))) for i in range(4)]
    rows = run_struct(_inst(), None, sc, range(4), 10, dispatch=("SPT", []))
    assert [r["profit"] for r in rows] == [r["profit"] for r in base]
    inv = run_struct(_inst(), lambda o, m: np.where(m[:, A["invest0"]], A["invest0"], 0), sc, range(4), 10, dispatch=("SPT", []))
    assert all(r["a3"]["capex"] > 0 for r in inv)
    assert all(abs(r["cash_residual"]) < 1e-3 for r in inv)


def test_struct_gym_env_episode_and_paired_reward():
    sc = ScenarioSet(4, 777, stress=STRESSES["base"])
    ref = [{"profit": [0.0] * 4, "min_cash": [0.0] * 4}]
    env = StructEnv([_inst()], sc, 0, [("SPT", [])], ref=ref)
    assert env.observation_space.shape == (N_OBS,) and env.action_space.n == N_ACT
    obs, _ = env.reset(seed=1)
    done, steps, r = False, 0, 0.0
    while not done:
        m = env.action_masks()
        assert m[0]
        obs, r, done, _, info = env.step(0)
        steps += 1
    assert steps >= 1 and np.isfinite(r) and "summary" in info


def test_invest_eval_pays_when_bottleneck_binds():
    me = load_module()
    sc = ScenarioSet(6, 777, stress=STRESSES["calm"])
    js = [sc.scenario_json(i) for i in range(6)]
    cfg = make_config({"dense_reward": False})
    pay = json.loads(me.invest_eval(_inst(50), cfg, 0, js, [100 + i for i in range(6)], "EDD", [], 0, 260, 0.0, 2))
    nopay = json.loads(me.invest_eval(_inst(10), cfg, 0, js, [100 + i for i in range(6)], "EDD", [], 0, 260, 0.0, 2))
    assert pay["npv_mean"] > 0 > nopay["npv_mean"]
    assert not nopay["apply"]
