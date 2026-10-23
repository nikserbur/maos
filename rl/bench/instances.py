"""Экземпляры для V4: Taillard (JSSP), Brandimarte (FJSP) → JSON SimEnv; экземпляры MAOS из демо-БД.

Сырые файлы в rl/bench/data/raw — недоверенные данные (только разбор, никогда не исполняются).
Формат Taillard: «n m», затем n строк по m пар (machine time). Формат .fjs: «n m [avg]», затем
по строке на job: n_ops, далее для каждой операции k и k пар (machine time); машины 1-based.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
RAW = HERE / "data" / "raw"
OUT = HERE / "data" / "instances"
REPO = HERE.parent.parent

# Лучшие известные значения (BKS). Taillard 15×15 ta01–ta10 — оптимумы (Taillard 1993;
# подтверждены в литературе); Brandimarte mk01–mk10 — BKS по Reijnen et al. (arXiv:2308.12794) и
# классическим таблицам FJSP (mk03/mk08 — доказанные оптимумы).
BKS = {
    "ta01": 1231, "ta02": 1244, "ta03": 1218, "ta04": 1175, "ta05": 1224,
    "ta06": 1238, "ta07": 1227, "ta08": 1217, "ta09": 1274, "ta10": 1241,
    "mk01": 40, "mk02": 26, "mk03": 204, "mk04": 60, "mk05": 172,
    "mk06": 57, "mk07": 139, "mk08": 523, "mk09": 307, "mk10": 197,
}


def _ints(line: str) -> list[int]:
    return [int(float(x)) for x in line.split()]


def parse_taillard(path: Path) -> list[list[list[tuple[int, int]]]]:
    lines = [ln for ln in path.read_text(encoding="utf-8").splitlines() if ln.strip()]
    n, m = _ints(lines[0])[:2]
    jobs = []
    for i in range(n):
        v = _ints(lines[1 + i])
        jobs.append([[(v[2 * k], v[2 * k + 1])] for k in range(m)])   # machine 0-based, одна альтернатива
    return jobs


def parse_fjs(path: Path) -> list[list[list[tuple[int, int]]]]:
    lines = [ln for ln in path.read_text(encoding="utf-8").splitlines() if ln.strip()]
    n = _ints(lines[0])[0]
    jobs = []
    for i in range(n):
        v = _ints(lines[1 + i])
        p, ops = 0, []
        n_ops = v[p]; p += 1
        for _ in range(n_ops):
            k = v[p]; p += 1
            alts = []
            for _ in range(k):
                alts.append((v[p] - 1, v[p + 1])); p += 2       # 1-based → 0-based
            ops.append(alts)
        jobs.append(ops)
    return jobs


def to_instance_json(name: str, jobs: list[list[list[tuple[int, int]]]], n_machines: int) -> dict:
    """JSSP/FJSP → экземпляр SimEnv: тип РЦ = машина (по одному станку), изделие = job (цепочка операций)."""
    wct = [{"id": f"M{m}", "name": f"M{m}"} for m in range(n_machines)]
    machines = [{"id": f"m{m}", "wct": f"M{m}"} for m in range(n_machines)]
    products, orders = [], []
    for j, ops in enumerate(jobs):
        pops = []
        for k, alts in enumerate(ops):
            times = {f"M{m}": float(t) for m, t in alts}
            pops.append({"id": f"j{j}o{k}", "name": f"j{j}o{k}", "wc_types": list(times.keys()),
                         "t_exp": float(np.mean(list(times.values()))), "sigma": 0.0, "setup": 0.0, "risk": 0.0,
                         "tail_w": 0.0, "tail_idx": 2.5, "order_no": k, "inputs": [], "t_by_type": times})
        products.append({"id": f"J{j}", "name": f"J{j}", "batch_size": 1, "ops": pops})
        orders.append({"product_id": f"J{j}", "qty": 1, "due_h": 1e6, "price": 0, "mat_cost": 0})
    return {"name": name, "wc_types": wct, "machines": machines, "products": products, "workers": [],
            "orders": orders, "outsource": {"lead_h": 0}, "fin": {"c0": 0, "credit_limit": 0}, "tail_weight": 0.0}


def lower_bound(jobs: list[list[list[tuple[int, int]]]], n_machines: int) -> float:
    """LB = max(самая длинная цепочка по min-времени, max_machine Σ работ с единственной альтернативой)."""
    chain = max(sum(min(t for _, t in alts) for alts in ops) for ops in jobs)
    load = np.zeros(n_machines)
    for ops in jobs:
        for alts in ops:
            if len(alts) == 1:
                load[alts[0][0]] += alts[0][1]
    return float(max(chain, load.max()))


def benchmark_instances() -> list[tuple[str, dict, float]]:
    """(имя, JSON, LB) для ta01–ta10 и mk01–mk10 (если скачаны)."""
    out = []
    for i in range(1, 11):
        p = RAW / "taillard" / f"ta{i:02d}"
        if p.exists():
            jobs = parse_taillard(p)
            m = len(jobs[0])
            out.append((f"ta{i:02d}", to_instance_json(f"ta{i:02d}", jobs, m), lower_bound(jobs, m)))
    for i in range(1, 11):
        p = RAW / "brandimarte" / f"Mk{i:02d}.fjs"
        if p.exists():
            jobs = parse_fjs(p)
            m = max(mc for ops in jobs for alts in ops for mc, _ in alts) + 1
            out.append((f"mk{i:02d}", to_instance_json(f"mk{i:02d}", jobs, m), lower_bound(jobs, m)))
    return out


# ── Экземпляры MAOS из демо-БД ──────────────────────────────────────────────
FIN_SCALE = {"credit_limit_share": 0.15, "c0_share": 0.05}   # [К] rl.fin_scale: лимит/касса как доля стоимости портфеля


def maos_instances(db_path: Path | None = None, n_random: int = 9, seed: int = 20261022) -> list[tuple[str, dict]]:
    """3 плана demand_orders + n_random случайных подмножеств изделий (малые/средние; детерминированно по seed).
    Финансы масштабируются к стоимости портфеля (FIN_SCALE), иначе лимит демо (20 млн) несопоставим с
    заказами на миллиарды — раскрыто в паспорте rl.fin_scale."""
    import sqlite3
    from rl.env.core import load_module
    me = load_module()
    db_path = db_path or (REPO / "backend" / "build" / "maos.db")
    con = sqlite3.connect(str(db_path))
    plans = [r[0] for r in con.execute("SELECT DISTINCT plan_id FROM demand_orders WHERE status<>'done' ORDER BY plan_id")]
    sellable = [(r[0], float(r[1]), float(r[2])) for r in con.execute(
        "SELECT p.id, p.demand_max, p.base_price FROM products p WHERE p.sellable=1 AND EXISTS(SELECT 1 FROM routings r WHERE r.product_id=p.id) ORDER BY p.id")]
    out = []
    for pi, plan in enumerate(plans):
        rows = con.execute("SELECT product_id, quantity, due_hours FROM demand_orders WHERE plan_id=? AND status<>'done' ORDER BY priority, due_hours", (plan,)).fetchall()
        prog = [(r[0], float(r[1])) for r in rows]
        due = [float(r[2]) for r in rows]
        inst = me.instance_from_db(str(db_path), prog, due, True)
        out.append((f"maos-plan{pi + 1}", _scale_fin(json.loads(inst.to_json()), f"maos-plan{pi + 1}")))
    rng = np.random.default_rng(seed)
    sizes = [3, 4, 5, 6, 8, 8, 10, 12, 14, 16, 18, 20]
    for r in range(n_random):
        k = sizes[r % len(sizes)]
        idx = rng.choice(len(sellable), size=min(k, len(sellable)), replace=False)
        prog = [(sellable[i][0], float(max(5, round(sellable[i][1] * rng.uniform(0.02, 0.12))))) for i in idx]
        due = [float(rng.choice([240, 480, 720, 1080, 1440, 2160])) for _ in idx]   # поток rng как в A1
        inst = me.instance_from_db(str(db_path), prog, due, True)
        js = _calibrate_due(me, json.loads(inst.to_json()), rng)
        out.append((f"maos-rnd{r + 1}", _scale_fin(js, f"maos-rnd{r + 1}")))
    con.close()
    return out


DUE_RANGE = (0.35, 1.1)   # [К] rl.nsi.bench_due: срок = Cmax(EDD) × U(a, b) — сроки напряжены (A2)


def _calibrate_due(me, js: dict, rng: np.random.Generator) -> dict:
    """Сроки случайного экземпляра — доли детерминированного Cmax правила EDD (A2: при сроках
    240…2160 ч OTD = 1 и прибыль нечувствительна к расписанию, A1 §5)."""
    from rl.env.core import make_config, run_rule
    env = me.SimEnv(me.Instance.from_json(json.dumps(js)),
                    make_config({"event_mode": False, "deterministic": True, "breakdowns": False, "dense_reward": False}))
    cmax_h = run_rule(env, "EDD", 1)["makespan_h"]
    for o in js["orders"]:
        o["due_h"] = float(round(cmax_h * rng.uniform(*DUE_RANGE), 1))
    return js


def _scale_fin(j: dict, name: str) -> dict:
    value = sum(float(o["price"]) * float(o["qty"]) for o in j["orders"])
    j["name"] = name
    j["fin"]["credit_limit"] = FIN_SCALE["credit_limit_share"] * value
    j["fin"]["c0"] = FIN_SCALE["c0_share"] * value
    j["outsource"] = {"lead_h": 72.0, "markup": 1.3, "prepay": 0.5}     # [К] rl.outsource_*
    return j


def write_all() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    meta = {}
    for name, js, lb in benchmark_instances():
        (OUT / f"{name}.json").write_text(json.dumps(js), encoding="utf-8")
        meta[name] = {"lb": lb, "bks": BKS.get(name), "n_jobs": len(js["products"]), "n_machines": len(js["machines"])}
    for name, js in maos_instances():
        (OUT / f"{name}.json").write_text(json.dumps(js), encoding="utf-8")
        meta[name] = {"n_orders": len(js["orders"]), "n_machines": len(js["machines"])}
    (OUT / "index.json").write_text(json.dumps(meta, indent=1, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    write_all()
