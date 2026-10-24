"""Предрегистрированное семейство экземпляров A3 (rl/eval/prereg_a3.md §2): ≥ 30 экземпляров MAOS с узким
местом по мощности, жёсткими договорными сроками для ВСЕХ заказов и вариантами с тесной кассой.

    rl/.venv/bin/python -m rl.bench.instances_a3            # → rl/bench/data/instances_a3/*.json + index.json

Детерминированно по seed (A3_SEED + i). База — обогащённая демо-НСИ (backend/build/maos.db: модель завода,
маршруты, допуски, календарь 06–22 Пн–Пт). Для экземпляра i:
  1. профиль изделий — тип РЦ с ≤ 3 станками, нужный ≥ 5 изделиям (изделия берутся из его пользователей);
     окно класса W = 3 / 8 / 16 недель (малые / средние / крупные); заказы добавляются по одному (запуск на
     границе недели U{0..W−3}, объём = U(0.3, 1) × предела, при котором собственный цикл заказа в пустом
     цехе ≤ 1.5 нед.), пока загрузка САМОГО нагруженного типа за окно не станет ρ_i ∈ {0.9, 1.1, 1.25, 1.4}:
     спрос превышает мощность узкого места на 10–40 % (0.9 — контроль без перегрузки);
  2. цена = стандартная себестоимость (материалы + машино-часы + труд со взносами) × (1 + μ), μ ~ U(0.25, 0.6);
     постоянные расходы недели = φ × маржинальный доход портфеля / 26, φ ~ U(0.3, 0.5) — прибыль чувствительна
     к просрочкам и к затратам мощности (в демо-НСИ маржа ≈ 95 %, A2 §5.5);
  3. сроки = запуск + (окончание детерминированного EDD − запуск) / ρ × U(0.9, 1.2) — обещаны «как при ρ = 1»;
     договор: 3 % стоимости при любой просрочке + 2 %/нед., потолок 25 %;
  4. касса: c0 = 2 недели постоянных; лимит линии = 1.25 × q90 пиковой потребности в деньгах плана «лучшее по
     средней прибыли правило без ходов» на 16 калибровочных сценариях (тесная касса, нечётные i, — 1.0 × медианы);
     налог на прибыль — нарастающим итогом с начала года (поправка П1);
  5. кандидаты L3: станок узкого места по TOC, модернизация узкого места (MTBF × 2, ремонт × 0.7), станок типа с
     наибольшей ценностью мощности по двойственным ценам LP (max Σ маржа·x, Σ работа·x ≤ фонд, 0 ≤ x ≤ 1).
Все константы — [К] с кодами паспорта rl.a3.*.
"""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import numpy as np
from scipy.optimize import linprog

from rl.bench.instances import REPO

OUT = Path(__file__).resolve().parent / "data" / "instances_a3"
A3_SEED = 20261023                 # [НОРМ] предрегистрация
N_INST = 30
WINDOW = [3, 6, 12]                                 # окно класса (малые / средние / крупные, по 10), недель [К] rl.a3.window
F_MAX_H = 2.0 * 168.0                               # предельный собственный цикл заказа в пустом цехе [К] rl.a3.order_flow
QTY_SHARE = (0.5, 1.0)                              # объём заказа — доля предельного [К]
K_MAX = 80                                          # предохранитель числа заказов
RHO = [0.9, 1.1, 1.25, 1.4]                         # загрузка узкого места за окно класса [К] rl.a3.rho
MARKUP = (0.25, 0.6)                                # наценка к стандартной себестоимости [К] rl.a3.markup
FIXED_SHARE = (0.3, 0.5)                            # постоянные расходы / маржинальный доход [К] rl.a3.fixed
DUE_MUL = (0.9, 1.2)                                # срок: (EDD − запуск)/ρ × U(0.9, 1.2) [К] rl.a3.due
CONTRACT = {"late_fixed": 0.03, "late_per_week": 0.02, "late_cap": 0.25}  # [К] rl.a3.contract
CREDIT = ((0.9, 1.25), (0.5, 1.0))                  # лимит линии: (квантиль, множитель) потребности — обычная / тесная касса [К] rl.a3.credit
OVERTIME = {"overtime_hours_week": 16.0, "overtime_cost_mul": 0.6}        # [К] rl.a3.overtime
OUTSOURCE_OP = {"outsource_op_markup": 1.6, "outsource_op_share": 0.25}   # [К] rl.a3.outsource_op
INVEST = {"capex_hours": 4000.0, "capex_mul": 1.5, "lead_weeks": 6.0, "opex_share_week": 0.002, "life_weeks": 520.0,
          "modern_share": 0.15, "modern_lead": 2.0, "mtbf_mul": 2.0, "repair_mul": 0.7, "prepay": 0.3}   # [К] rl.a3.invest.*
WEEK_H = 168.0


def _env(me, js: dict, cfg: dict | None = None):
    from rl.env.core import make_config
    base = {"event_mode": True, "deterministic": True, "breakdowns": False, "dense_reward": False}
    return me.SimEnv(me.Instance.from_json(json.dumps(js)), make_config({**base, **(cfg or {})}))


CALIB_SEED, CALIB_N = 4242, 16                      # калибровочные сценарии (не обучение/валидация/holdout) [НОРМ]


def financing_need(me, js: dict) -> np.ndarray:
    """Пиковая потребность в деньгах −min netCash при нулевом лимите линии — для правила с наибольшей средней
    прибылью из 7 на калибровочных сценариях генератора базы (поправка П2: калибровка по EDD давала «тесной» кассе
    разрыв только у плохого правила). Без структурных ходов."""
    from rl.env.core import make_config
    from rl.env.scenarios import STRESSES, ScenarioSet
    js2 = json.loads(json.dumps(js))
    js2["fin"]["credit_limit"] = 0.0
    js2["fin"]["overdraft_limit"] = 0.0
    sc = ScenarioSet(CALIB_N, CALIB_SEED, stress=STRESSES["base"])
    env = me.SimEnv(me.Instance.from_json(json.dumps(js2)), make_config({"dense_reward": False}))
    best, best_p = None, -np.inf
    for rule in ("EDD", "SPT", "LPT", "CR", "MWKR", "MS", "FIFO"):
        need, prof = [], []
        for i in range(CALIB_N):
            env.reset(CALIB_SEED + i, sc.scenario_json(i))
            while not env.done:
                env.step_job(env.rule_choice(rule))
            s = json.loads(env.summary())
            need.append(max(1.0, -float(s["min_cash"]))); prof.append(float(s["profit"]))
        if np.mean(prof) > best_p:
            best, best_p = np.asarray(need), float(np.mean(prof))
    return best


def _week_cap_min(js: dict) -> float:
    cal = js["calendar"]
    if not cal.get("any"):
        return WEEK_H * 60.0
    return float(sum(e - s for d in cal["days"] for s, e in d))


def order_profile(me, js: dict) -> tuple[np.ndarray, list[str], np.ndarray]:
    """(работа заказа по ведущему типу [K×W], типы, стандартные конверсионные затраты заказа [K])."""
    rate = {}
    for p in js["products"]:
        for o in p["ops"]:
            rate[o["id"]] = float(o.get("hour_rate", 0)) + 1.3 * float(o.get("labor_rate", 0))   # труд со взносами 30 %
    env = _env(me, js)
    info = json.loads(env.job_info())
    types = sorted({w["id"] for w in js["wc_types"]})
    ti = {t: i for i, t in enumerate(types)}
    K = len(js["orders"])
    work = np.zeros((K, len(types)))
    conv = np.zeros(K)
    for j in info:
        k = j["order"]
        if k >= K or not j["wc_types"]:
            continue
        work[k, ti[j["wc_types"][0]]] += j["dur"]
        conv[k] += j["dur"] / 60.0 * rate.get(j["op"], 0.0)
    return work, types, conv


def capacity(js: dict, types: list[str]) -> np.ndarray:
    n = {t: 0 for t in types}
    for m in js["machines"]:
        n[m["wct"]] = n.get(m["wct"], 0) + 1
    return np.array([n[t] for t in types], float) * _week_cap_min(js)


def lp_duals(work: np.ndarray, contrib: np.ndarray, cap: np.ndarray, weeks: int) -> np.ndarray:
    """Двойственные цены мощности типов (₽ за машино-минуту) в LP max Σ c·x, Σ_k a_kw x_k ≤ cap_w·W, 0 ≤ x ≤ 1."""
    K, W = work.shape
    used = work.sum(0) > 0
    A = work[:, used].T
    b = cap[used] * weeks
    res = linprog(-contrib, A_ub=A, b_ub=b, bounds=[(0, 1)] * K, method="highs")   # HiGHS, двойственные — marginals
    y = np.zeros(W)
    if res.status == 0:
        y[used] = -np.asarray(res.ineqlin.marginals)
    return y


def det_finish(me, js: dict) -> np.ndarray:
    """Окончания заказов детерминированного EDD (средние, без поломок; сроки-заглушки = запуск + 4 нед.), ч."""
    js2 = json.loads(json.dumps(js))
    for o in js2["orders"]:
        o["due_h"] = o.get("release_h", 0.0) + 4 * WEEK_H
    env = _env(me, js2)
    env.reset(1, "")
    while not env.done:
        env.step_job(env.rule_choice("EDD"))
    fin = np.zeros(len(js2["orders"]))
    for g in json.loads(env.gantt()):
        fin[g["order_idx"]] = max(fin[g["order_idx"]], g["end"])
    return fin


def product_profiles(me, db: Path, sellable: list[tuple[str, float]]) -> dict:
    """Удельная работа изделия по ведущим типам РЦ (мин на единицу, заказ 100 шт.) и собственный цикл заказа
    100 шт. в пустом цехе (ч) — для выбора узкого места и предельного объёма заказа."""
    out = {}
    for pid, _ in sellable:
        js = json.loads(me.instance_from_db(str(db), [(pid, 100.0)], [0.0], True).to_json())
        work, types, _ = order_profile(me, js)
        out[pid] = {t: float(w) / 100.0 for t, w in zip(types, work[0]) if w > 0}
        out[pid]["_flow100_h"] = float(det_finish(me, js).max())
    return out


def focal_types(js_any: dict, prof: dict) -> list[str]:
    """Кандидаты в узкое место: тип с ≤ 3 станками, нужный ≥ 5 изделиям (≥ 1 мин/ед.)."""
    nm: dict[str, int] = {}
    for m in js_any["machines"]:
        nm[m["wct"]] = nm.get(m["wct"], 0) + 1
    users: dict[str, int] = {}
    for p in prof.values():
        for t, w in p.items():
            if not t.startswith("_") and w >= 1.0:
                users[t] = users.get(t, 0) + 1
    return sorted(t for t, u in users.items() if u >= 5 and 0 < nm.get(t, 0) <= 3)


def make_instance(me, db: Path, prof: dict, focal: list[str], i: int, seed: int = A3_SEED,
                  prefix: str = "a3") -> tuple[str, dict, dict]:
    rng = np.random.default_rng([seed, i])
    cls = i // 10 % 3
    W = WINDOW[cls]
    rho = RHO[i % len(RHO)]
    tight = i % 2 == 1
    b = focal[int(rng.integers(len(focal)))]
    pool = sorted(p for p, w in prof.items() if w.get(b, 0) >= 1.0)
    js_probe = json.loads(me.instance_from_db(str(db), [(pool[0], 1.0)], [0.0], True).to_json())
    types = sorted({w["id"] for w in js_probe["wc_types"]})
    cap = capacity(js_probe, types) * W                              # фонд типов за окно, мин
    # Заказы по одному, пока загрузка самого нагруженного типа за окно не достигнет ρ: объём ≤ предела, при
    # котором собственный цикл заказа в пустом цехе ≤ F_MAX (иначе срок определяет транзит партий, а не мощность).
    prog, rel, load = [], [], np.zeros(len(types))
    while load.max() < rho and len(prog) < K_MAX:
        p = pool[int(rng.integers(len(pool)))]
        qmax = 100.0 * F_MAX_H / max(1.0, prof[p]["_flow100_h"])
        q = float(max(1, round(qmax * rng.uniform(*QTY_SHARE))))
        u = np.array([prof[p].get(t, 0.0) for t in types]) * q / np.maximum(1.0, cap)
        if (load + u).max() > rho:                                   # последний заказ — ровно до ρ
            q = float(max(1, round(q * (rho - load.max()) / max(1e-9, (load + u).max() - load.max()))))
            u = np.array([prof[p].get(t, 0.0) for t in types]) * q / np.maximum(1.0, cap)
        prog.append((p, q)); rel.append(float(rng.integers(0, max(1, W - 3) + 1)) * WEEK_H); load = load + u
    K = len(prog)
    js = json.loads(me.instance_from_db(str(db), prog, [0.0] * K, True).to_json())
    for o, r in zip(js["orders"], rel):
        o["release_h"] = r
    work, types, conv = order_profile(me, js)
    cap = capacity(js, types)
    # Цены: стандартная себестоимость × (1 + μ).
    contrib = np.zeros(len(js["orders"]))
    for k, o in enumerate(js["orders"]):
        qk = max(1.0, float(o["qty"]))
        unit = float(o["mat_cost"]) + conv[k] / qk
        o["price"] = float(round(unit * (1 + rng.uniform(*MARKUP)), 2))
        contrib[k] = (o["price"] - unit) * qk
    value = float(sum(o["price"] * o["qty"] for o in js["orders"]))
    fixed_w = float(rng.uniform(*FIXED_SHARE) * contrib.sum() / 26.0)
    # Сроки обещаны «как при ρ = 1»: запуск + (окончание детерминированного EDD − запуск) / ρ × U(0.9, 1.2).
    fin = det_finish(me, js)
    for k, o in enumerate(js["orders"]):
        o["due_h"] = float(round(o["release_h"] + max(24.0, (fin[k] - o["release_h"]) / rho * rng.uniform(*DUE_MUL)), 1))
    js["fixed"] = {"payroll_w": 0.0, "repair_w": 0.0, "other_w": fixed_w}
    js["fin"]["tax_cumulative"] = True     # поправка П1: налог на прибыль нарастающим итогом с начала года (ст. 285–287 НК РФ)
    js["fin"]["c0"] = 2 * fixed_w
    js["fin"]["c_min"] = 0.0
    # Лимит линии — от пиковой потребности в деньгах плана «лучшее по средней прибыли правило без ходов» (16
    # калибровочных сценариев, лимит 0):
    # обычная касса 1.25 × q90 потребности (разрыв редок), тесная — 1.0 × медианы (разрыв в каждом втором сценарии).
    need = financing_need(me, js)
    qv, mul = CREDIT[1 if tight else 0]
    js["fin"]["credit_limit"] = float(mul * np.quantile(need, qv))
    js["outsource"] = {"lead_h": 72.0, "markup": 1.3, "prepay": 0.5}
    # Кандидаты L3: TOC-узкое место (max загрузки за окно), его модернизация, тип с наибольшей ценностью
    # мощности по двойственным ценам LP (если совпадает с TOC — следующий по загрузке).
    load = work.sum(0) / np.maximum(1.0, cap * W)
    b1 = int(np.argmax(load))
    y = lp_duals(work, contrib, cap, W)
    val = y * cap
    order_v = [w for w in np.argsort(-val) if w != b1 and cap[w] > 0 and val[w] > 0]
    order_l = [w for w in np.argsort(-load) if w != b1 and cap[w] > 0]
    b2 = int(order_v[0]) if order_v else int(order_l[0])
    typeinfo = {w["id"]: w for w in js["wc_types"]}
    rate: dict[str, list[float]] = {}
    for p in js["products"]:
        for o in p["ops"]:
            for t in o["wc_types"]:
                rate.setdefault(t, []).append(float(o.get("hour_rate", 0)) + float(o.get("labor_rate", 0)))
    nmach = {t: 0 for t in types}
    for m in js["machines"]:
        nmach[m["wct"]] += 1

    def machine(w: int, src: str) -> dict:
        t = types[w]
        capex = INVEST["capex_mul"] * INVEST["capex_hours"] * float(np.mean(rate.get(t, [1000.0])))
        return {"id": f"m-{t}", "kind": "machine", "wct": t, "capex": capex, "lead_weeks": INVEST["lead_weeks"],
                "opex_weekly": INVEST["opex_share_week"] * capex, "life_weeks": INVEST["life_weeks"],
                "prepay_share": INVEST["prepay"], "source": src}

    m1 = machine(b1, "toc")
    t1 = types[b1]
    has_risk = float(typeinfo.get(t1, {}).get("mtbf", 0)) > 0
    mod = {"id": f"mod-{t1}", "kind": "modernize", "wct": t1,
           "capex": INVEST["modern_share"] * m1["capex"] * max(1, nmach[t1]), "lead_weeks": INVEST["modern_lead"],
           "opex_weekly": 0.0, "life_weeks": INVEST["life_weeks"], "mtbf_mul": INVEST["mtbf_mul"] if has_risk else 1.0,
           "repair_mul": INVEST["repair_mul"] if has_risk else 1.0, "prepay_share": INVEST["prepay"], "source": "toc"}
    js["a3"] = {**CONTRACT, **OVERTIME, **OUTSOURCE_OP, "invest_cands": [m1, mod, machine(b2, "dual")]}
    name = f"{prefix}-{['s', 'm', 'l'][cls]}{i:02d}"
    js["name"] = name
    meta = {"rho": rho, "window_w": W, "focal": b, "det_makespan_w": float(fin.max() / WEEK_H), "cash_tight": tight,
            "n_orders": len(js["orders"]), "value": value, "fixed_w": fixed_w, "bottleneck": t1,
            "bottleneck_load": float(load[b1]), "dual_type": types[b2],
            "duals_per_hour": {types[w]: float(y[w] * 60) for w in np.argsort(-val)[:3]},
            "n_jobs": int(len(json.loads(_env(me, js).job_info())))}
    return name, js, meta


def write_all(db: Path | None = None, seed: int = A3_SEED, out: Path = OUT, prefix: str = "a3") -> dict:
    """A4: seed/out/prefix — свежий набор F того же генератора (rl/eval/prereg_a4.md §2)."""
    from rl.env.core import load_module
    me = load_module()
    db = db or (REPO / "backend" / "build" / "maos.db")
    con = sqlite3.connect(str(db))
    sellable = [(r[0], float(r[1])) for r in con.execute(
        "SELECT p.id, p.demand_max FROM products p WHERE p.sellable=1 AND EXISTS(SELECT 1 FROM routings r WHERE r.product_id=p.id) ORDER BY p.id")]
    con.close()
    out.mkdir(parents=True, exist_ok=True)
    prof = product_profiles(me, db, sellable)
    focal = focal_types(json.loads(me.instance_from_db(str(db), [(sellable[0][0], 1.0)], [0.0], True).to_json()), prof)
    index = {}
    for i in range(N_INST):
        name, js, meta = make_instance(me, db, prof, focal, i, seed, prefix)
        (out / f"{name}.json").write_text(json.dumps(js), encoding="utf-8")
        index[name] = meta
        print(name, {k: meta[k] for k in ("rho", "cash_tight", "n_orders", "n_jobs", "bottleneck", "bottleneck_load")}, flush=True)
    (out / "index.json").write_text(json.dumps(index, indent=1, ensure_ascii=False), encoding="utf-8")
    return index


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=A3_SEED)
    ap.add_argument("--out", type=Path, default=OUT)
    ap.add_argument("--prefix", default="a3")
    a = ap.parse_args()
    write_all(seed=a.seed, out=a.out, prefix=a.prefix)
