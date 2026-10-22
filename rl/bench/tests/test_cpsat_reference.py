"""CP-SAT эталон и разбор бенчмарков (§11.5: test_cpsat_reference / test_benchmarks)."""
import json
import math

import pytest

from rl.bench import instances as bi
from rl.bench.cpsat import solve_from_env
from rl.env.core import load_module, make_config, run_rule


def test_parse_taillard_and_lb():
    p = bi.RAW / "taillard" / "ta01"
    if not p.exists():
        pytest.skip("ta01 не скачан")
    jobs = bi.parse_taillard(p)
    assert len(jobs) == 15 and len(jobs[0]) == 15
    assert bi.lower_bound(jobs, 15) <= bi.BKS["ta01"]


def test_parse_fjs():
    p = bi.RAW / "brandimarte" / "Mk01.fjs"
    if not p.exists():
        pytest.skip("Mk01 не скачан")
    jobs = bi.parse_fjs(p)
    assert len(jobs) == 10
    assert any(len(alts) > 1 for ops in jobs for alts in ops)


def test_cpsat_small_exact_and_rules_above_it():
    """2 станка, 3 job'а — оптимум CP-SAT известен; все правила ≥ оптимума; детерминированный Cmax по типам."""
    jobs = [[[(0, 3)], [(1, 2)]], [[(0, 2)], [(1, 4)]], [[(1, 1)], [(0, 3)]]]
    js = bi.to_instance_json("tiny", jobs, 2)
    me = load_module()
    inst = me.Instance.from_json(json.dumps(js))
    env = me.SimEnv(inst, make_config({"event_mode": False, "deterministic": True, "breakdowns": False}))
    env.reset(1)
    cp = solve_from_env(env, 5.0)
    assert cp.status in ("OPTIMAL", "FEASIBLE")
    assert math.isclose(cp.makespan, 8.0, abs_tol=1e-6)
    for r in ["EDD", "SPT", "LPT", "MWKR", "FIFO"]:
        assert run_rule(env, r, 1)["makespan_h"] * 60 >= cp.makespan - 1e-6


def test_fjsp_per_machine_times_respected():
    """Op с разными временами на станках: детерминированный Cmax = время выбранного станка."""
    jobs = [[[(0, 10), (1, 2)]]]
    js = bi.to_instance_json("alt", jobs, 2)
    me = load_module()
    env = me.SimEnv(me.Instance.from_json(json.dumps(js)), make_config({"event_mode": False, "deterministic": True, "breakdowns": False}))
    r = run_rule(env, "SPT", 1)
    assert r["makespan_h"] * 60 in (10.0, 2.0)
