"""A4: наблюдение 80 (последствия ходов, таблица взгляда вперёд, дескрипторы), LA-политика и награда RU-CVaR по пакету."""
import json

import numpy as np

from rl.env.core import load_module, make_config
from rl.env.l3_env import A, STRUCT_CFG
from rl.env.scenarios import STRESSES, ScenarioSet
from rl.env.tests.test_l3 import _inst
from rl.eval.a4_common import CFG4, F4, LookAhead
from rl.train.train_l4 import group_rewards


def _first_epoch(inst, cfg: dict):
    env = load_module().SimEnv(inst, make_config({**STRUCT_CFG, **cfg}))
    env.set_dispatch("EDD", [])
    env.reset(11, ScenarioSet(1, 777, stress=STRESSES["base"]).scenario_json(0))
    while env.level == 0 and not env.done:
        env.run_l0()
    return env


def test_a4_observation_extends_a3_and_prices_overtime():
    inst = _inst(qty=60.0)
    e3, e4 = _first_epoch(inst, {}), _first_epoch(inst, CFG4)
    o3, o4 = e3.obs_l2(), e4.obs_l2()
    assert e3.obs_l2_size == 48 and e4.obs_l2_size == 80
    np.testing.assert_allclose(o3, o4[:48])                      # признаки A3 не меняются
    m = e4.mask_l2()
    assert m[A["overtime"]]
    assert o4[F4["ot_fee"]] > 0                                  # плата за смену > 0
    assert abs(o4[F4["ot_net"]] - (o4[F4["ot_pen"]] + o4[F4["ot_hor"]] - o4[F4["ot_fee"]])) < 1e-4
    assert o4[F4["cls"]:F4["cls"] + 3].sum() == 1.0              # класс экземпляра — one-hot
    assert o4[F4["liq"]] > 0


def test_invest_lookahead_table_reaches_observation():
    js = json.loads(_inst().to_json())
    row = [[0.5, 0.2, -0.1, 3.0]] + [[0.0] * 4] * 25
    js["a3"]["invest_la"] = [row]
    inst = load_module().Instance.from_json(json.dumps(js))
    assert json.loads(inst.to_json())["a3"]["invest_la"][0][0] == row[0]
    o = _first_epoch(inst, CFG4).obs_l2()
    np.testing.assert_allclose(o[F4["inv"]:F4["inv"] + 4], row[0], atol=1e-6)
    # LA(0) покупает кандидата с ΔCVaR > 0, ΔE > 0, ΔP(разрыва) ≤ 0 и запасом после транша.
    m = np.zeros((1, 13), bool); m[0, 0] = m[0, A["invest0"]] = True
    assert LookAhead(0.0)(o[None, :], m)[0] == A["invest0"]
    o2 = o.copy(); o2[F4["inv"] + 2] = 0.05                      # ΔP(разрыва) > 0 → не покупать
    assert LookAhead(0.0)(o2[None, :], m)[0] == 0


def test_ru_batch_reward_zero_for_reference_and_positive_for_better_tail():
    idx = list(range(20))
    ref = {"profit": list(np.linspace(-10, 9, 20)), "min_cash": [0.0] * 20}
    same = [{"profit": p, "min_cash": 0.0} for p in ref["profit"]]
    assert np.allclose(group_rewards(same, ref, idx, 100.0, 0.5), 0.0)
    better_tail = [{"profit": max(p, -5.0), "min_cash": 0.0} for p in ref["profit"]]
    r = group_rewards(better_tail, ref, idx, 100.0, 1.0)
    assert r.mean() > 0 and np.all(r >= -1e-12)
