"""Полная модель CP-SAT (правило «CP-SAT», A2): наладки, календари, рабочие, альтернативы, sidecar."""
import json
import threading
import urllib.request

import pytest

from rl.bench import instances as bi
from rl.bench.cpsat_full import payload_from_instance, solve_payload, validate_payload


def job(order, product, dur, types=("A",), setup=0.0, preds=(), release=0.0, dbt=None, worker=True):
    return {"order": order, "op": f"o{order}{product}", "product": product, "wc_types": list(types), "dur": dur,
            "dur_by_type": dbt or [], "setup": setup, "preds": list(preds), "release": release, "needs_worker": worker}


def base(jobs, machines=(("m1", "A"),), **kw):
    p = {"name": "t", "time_limit_s": 10, "workers": 4, "machines": [{"id": i, "wct": t} for i, t in machines],
         "n_workers": 0, "jobs": jobs}
    p.update(kw)
    return p


def windows(days, horizon):
    out = []
    for d in range(horizon // 1440 + 1):
        out += [(d * 1440 + s, d * 1440 + e) for s, e in days[d % 7]]
    return out


def test_setups_grouped_by_product_and_respected():
    """A, B, A на одном станке, наладка 10 при смене изделия: оптимум группирует A → Cmax 50 (а не 60)."""
    jobs = [job(0, "A", 10, setup=10), job(1, "B", 10, setup=10), job(2, "A", 10, setup=10)]
    r = solve_payload(base(jobs))
    assert r.status == "OPTIMAL"
    assert r.makespan == pytest.approx(50)
    seq = sorted(range(3), key=lambda i: r.starts[i])
    prev_prod, t = None, 0.0
    for i in seq:                            # наладка входит в интервал: старт ≥ конец предыдущего
        assert r.starts[i] >= t - 1e-9
        t = r.starts[i] + (10 if jobs[i]["product"] != prev_prod else 0) + 10
        prev_prod = jobs[i]["product"]
    assert t == pytest.approx(50)
    assert [jobs[i]["product"] for i in seq] in (["A", "A", "B"], ["B", "A", "A"])


def test_calendar_breaks_forbidden_and_24x7_override():
    """Смена 0–480 ежедневно: две операции по 300 мин не пересекают перерыв → вторая со следующего дня."""
    days = [[[0, 480]] for _ in range(7)]
    cal = {"any": True, "days": days}
    jobs = [job(0, "A", 300), job(1, "A", 300)]
    r = solve_payload(base(jobs, calendar=cal, calendar_mode="forbidden"))
    assert r.status == "OPTIMAL" and r.calendar_mode == "forbidden"
    assert r.makespan == pytest.approx(1440 + 300)
    win = windows([[(0, 480)]] * 7, 4000)
    for s in r.starts:
        assert any(a <= s and s + 300 <= b for a, b in win), s
    # Индивидуальный график 24×7 (any=false) снимает перерывы, а не падает на общий календарь.
    r2 = solve_payload(base(jobs, calendar=cal, machine_calendars={"m1": {"any": False, "days": []}}))
    assert r2.makespan == pytest.approx(600)


def test_uniform_calendar_warp_matches_sim_place_stretching():
    """Один календарь на все станки → ось рабочего времени: операция «растягивается» через перерыв,
    как в sim_place (advance): вторая из двух по 300 мин в смене 0–480 идёт 300–480 и 1440–1560."""
    from rl.bench.cpsat_full import Warp
    days = [[[0, 480]] for _ in range(7)]
    r = solve_payload(base([job(0, "A", 300), job(1, "A", 300)], calendar={"any": True, "days": days}))
    assert r.calendar_mode == "warp"
    assert sorted(r.starts) == [0.0, 300.0]
    assert r.makespan == pytest.approx(1560)
    w = Warp([[(360, 1320)]] * 5 + [[], []])      # пн–пт 06:00–22:00
    assert w.fwd(360) == 0 and w.fwd(1320) == 960 and w.fwd(5 * 1440) == 5 * 960
    assert w.start_of(960) == 1440 + 360            # конец смены → начало следующей (nextWork)
    assert w.end_of(960) == 1320                    # финиш ровно в конце смены (advance)
    assert w.end_of(5 * 960) == 4 * 1440 + 1320 and w.start_of(5 * 960) == 7 * 1440 + 360


def test_workers_cumulative_and_alternative_machines():
    """Один рабочий на два станка → операции последовательно; альтернатива с быстрым типом выбирается."""
    jobs = [job(0, "A", 10, types=("A",)), job(1, "B", 10, types=("B",))]
    m2 = (("m1", "A"), ("m2", "B"))
    assert solve_payload(base(jobs, machines=m2, n_workers=1)).makespan == pytest.approx(20)
    assert solve_payload(base(jobs, machines=m2, n_workers=2)).makespan == pytest.approx(10)
    alt = [job(0, "A", 100, types=("A", "B"), dbt=[["A", 100], ["B", 10]])]
    r = solve_payload(base(alt, machines=m2))
    assert r.makespan == pytest.approx(10) and r.machines == ["m2"]


def test_precedence_release_and_supply_without_machine():
    jobs = [job(0, "S", 50, types=()), job(0, "A", 10, preds=[0]), job(1, "A", 10, release=200)]
    r = solve_payload(base(jobs))
    assert r.starts[1] >= 50 - 1e-9 and r.starts[2] >= 200 - 1e-9
    assert r.machines[0] == "" and r.machines[1] == "m1"


def test_tardiness_in_objective_orders_by_due():
    jobs = [job(0, "A", 10), job(1, "A", 10)]
    r = solve_payload(base(jobs, due_min=[100, 10], w_tard=0.5))
    assert r.starts[1] < r.starts[0]
    assert r.tardiness == pytest.approx(0) and r.objective == pytest.approx(20)


def test_validation_rejects_bad_input():
    assert validate_payload({"jobs": []})
    assert validate_payload({"jobs": [{"dur": -1}]})
    assert validate_payload({"jobs": [{"dur": 1, "preds": [5]}]})
    assert solve_payload({"jobs": [{"dur": 1, "preds": [0]}]}).status == "ERROR"


def test_payload_from_instance_matches_reference_optimum():
    """Через развёртку SimEnv (maos_env) tiny-JSSP даёт тот же оптимум 8, что эталон V4."""
    jobs = [[[(0, 3)], [(1, 2)]], [[(0, 2)], [(1, 4)]], [[(1, 1)], [(0, 3)]]]
    p = payload_from_instance(bi.to_instance_json("tiny", jobs, 2))
    p["time_limit_s"] = 5
    assert solve_payload(p).makespan == pytest.approx(8)


def test_sidecar_http_roundtrip():
    from rl.cpsat_service import serve
    srv = serve(port=0)
    th = threading.Thread(target=srv.serve_forever, daemon=True)
    th.start()
    try:
        port = srv.server_address[1]
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=5) as h:
            assert json.loads(h.read())["ok"] is True
        body = json.dumps(base([job(0, "A", 10, setup=5), job(1, "B", 10, setup=5)])).encode()
        req = urllib.request.Request(f"http://127.0.0.1:{port}/solve", data=body, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            out = json.loads(resp.read())
        assert out["status"] == "OPTIMAL" and out["makespan"] == pytest.approx(30)
        assert len(out["starts"]) == 2 and out["machines"] == ["m1", "m1"]
    finally:
        srv.shutdown()
        srv.server_close()
