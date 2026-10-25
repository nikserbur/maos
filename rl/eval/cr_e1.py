"""CR-E1 — эффект контрагентского риска на тот же план: раннер этапов (предрегистрация, модель и результаты —
docs/research/K1-counterparty-risk.md; стенд и контрасты — rl/eval/cr_e1_core.py).

Запуск (из корня репозитория):
  rl/.venv/bin/python -m rl.eval.cr_e1 --out <dir> --ports 8091,8092,… --golden <dir> <этап…>
Этапы: gate plan main ablation terms sens vss stage1 lp gencheck summary (порядок §15: гейт 0 → 5–7 → 10, 11, 13, 14 →
8 → 9). Каждый ответ сервера кэшируется в <out>/raw — повторный запуск этапа досчитывает только недостающее.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import time
from pathlib import Path

import numpy as np

from rl.eval import cr_e1_stats as st
from rl.eval.cr_e1_core import (ABLATION, ALPHA, ARMS, B_BOOT, BETA, H5, H26, N_LP, N_PLAN, N_REP, N_WF, REGIMES,
                                REP_SEEDS, SEED, SEED_REP, SEED_VSS_SHIFT, SENS, ZERO_CP, Stand, arrays, contrast,
                                cp_block, did, eval_body, merge, p1p2_only, wf_summary)

ROOT = Path(__file__).resolve().parents[2]
DROP = {"solve_ms", "total_ms", "time_s", "counterparty", "fin_override", "run_id", "persist_error"}
LP_TIME_LIMIT = 300      # §8: с на задачу LP; ограничивает и ненужную здесь задачу «график заранее» (fixed_schedule)


def canon(j):
    """Канонический JSON без времён, блоков counterparty/fin_override и идентификатора прогона."""
    if isinstance(j, dict):
        return {k: canon(v) for k, v in j.items() if k not in DROP}
    if isinstance(j, list):
        return [canon(v) for v in j]
    return j


def sha(j) -> str:
    return hashlib.sha256(json.dumps(canon(j), sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def save(out: Path, name: str, obj) -> None:
    (out / name).write_text(json.dumps(obj, ensure_ascii=False, indent=1, default=float))


def load(out: Path, name: str):
    f = out / name
    return json.loads(f.read_text()) if f.exists() else None


# ── Гейт 0 ──────────────────────────────────────────────────────────────────────────────────────────────
def stage_gate(stand: Stand, out: Path, golden: Path) -> dict:
    """(б) CPR выкл. ≡ бинарь до изменений (эталон golden/demo_seed*.json); (в) enabled = 1 при нулевых
    вероятностях ≡ enabled = 0 при fin.pd = 0. Сравнение — равенство канонического JSON (и его sha256)."""
    jobs = []
    for s in (1, 42, 7):
        jobs.append((f"gate_b_s{s}", "/api/optimize", {"cash": True, "seed": s}))
        jobs.append((f"gate_c_off_s{s}", "/api/optimize", {"cash": True, "seed": s, **ARMS["A0"]}))
        jobs.append((f"gate_c_on_s{s}", "/api/optimize", {"cash": True, "seed": s, **ARMS["A0z"]}))
    res = stand.many(jobs, workers=len(stand.tokens))
    rep = {"b": {}, "c": {}}
    for s in (1, 42, 7):
        g = json.loads((golden / f"demo_seed{s}.json").read_text())
        b = res[f"gate_b_s{s}"]["data"]
        rep["b"][s] = {"equal": canon(b) == canon(g), "sha_api": sha(b), "sha_golden": sha(g)}
        off, on = res[f"gate_c_off_s{s}"]["data"], res[f"gate_c_on_s{s}"]["data"]
        rep["c"][s] = {"equal": canon(off) == canon(on), "sha_off": sha(off), "sha_on": sha(on)}
    rep["pass"] = all(v["equal"] for part in ("b", "c") for v in rep[part].values())
    save(out, "gate0.json", rep)
    return rep


# ── План x* ─────────────────────────────────────────────────────────────────────────────────────────────
def plan_body(hz: dict, arm: str = "A0", seed: int = SEED) -> dict:
    return merge({"cash": True, "objective": "cvar", "beta": BETA, "l_min": 0, "financing_stage": "recourse",
                  "seed": seed, "samples": N_PLAN, "cash_samples": N_PLAN, "pol_curve": False, **hz},
                 ARMS[arm], {"counterparty": {"lp_time_limit_sec": 3600}})


def plan_of(res: dict) -> dict:
    return {p["product_id"]: p["qty"] for p in res["data"]["cash_lp"]["portfolio"]}


def stage_plan(stand: Stand, out: Path) -> dict:
    res = stand.many([("plan26_A0", "/api/optimize", plan_body(H26)), ("plan5_A0", "/api/optimize", plan_body(H5)),
                      ("plan26_A2", "/api/optimize", plan_body(H26, "A2"))], workers=3)
    plans = {k: {"x": plan_of(v), "run_id": v["data"].get("run_id"), "port": v["port"], "status": v["data"]["cash_lp"]["status"],
                 "lp_ms": {"recourse": v["data"]["cash_lp"]["solve_ms"],
                           "fixed_schedule": v["data"]["cash_lp"]["fixed_schedule"].get("solve_ms"),
                           "unconstrained": v["data"]["cash_lp"]["unconstrained"].get("solve_ms")},
                 "total_ms": v["data"]["cash_lp"]["total_ms"], "request": v["request"]} for k, v in res.items()}
    save(out, "plans.json", plans)
    return plans


# ── §5–6: первичные и вторичные исходы ───────────────────────────────────────────────────────────────────
def main_jobs(plans: dict) -> list:
    x26, x5 = plans["plan26_A0"]["x"], plans["plan5_A0"]["x"]
    jobs = []
    for arm in ("A0", "A1", "A2"):
        for rg in REGIMES:
            for s in (SEED, SEED_REP):
                jobs.append((f"wf26_{arm}_{rg}_s{s}", "/api/optimize", eval_body(x26, arm, rg, s, N_WF, H26)))
            jobs.append((f"wf5_{arm}_{rg}_s{SEED}", "/api/optimize", eval_body(x5, arm, rg, SEED, N_WF, H5)))
    return jobs


def arm_stats(a: dict, res: dict) -> dict:
    k, n = int(a["breach"].sum()), len(a["breach"])
    return {"n": n, "cvar_cmin": st.cvar_lower(a["min_cash"], BETA), "p_breach": k / n, "p_breach_wilson": st.wilson(k, n),
            "E_profit": float(a["profit"].mean()), "cvar_profit": st.cvar_lower(a["profit"], ALPHA),
            "interest_mean": float(a["interest"].mean()), "max_debt_mean": float(a["max_debt"].mean()),
            "waterfall_rule": {k2: wf_summary(res).get(k2) for k2 in ("cfar", "p_breach", "dscr_min_p05", "p_covenant",
                                                                    "debt_peak", "int_cost", "t_breach_p10", "profit_mean",
                                                                    "profit_cvar", "identities_max_residual")},
            "counterparty": cp_block(res), "total_ms": res["data"]["cash_lp"].get("total_ms"), "wall_s": res["wall_s"]}


def stage_main(stand: Stand, out: Path, plans: dict, workers: int) -> dict:
    res = stand.many(main_jobs(plans), workers)
    A = {k: arrays(v) for k, v in res.items()}
    idx = st.boot_indices(N_WF, B_BOOT, SEED)
    rep = {"arms": {k: arm_stats(A[k], res[k]) for k in res}}
    prim = contrast(A["wf26_A2_base_s42"], A["wf26_A0_base_s42"], idx, bca=True)
    prim["holm"] = st.holm({"P1": prim["P1_cvar_cmin"]["p_boot"], "P2": prim["P2_breach"]["p_mcnemar"]})
    rep["primary_base_26"] = prim
    rep["replicate_seed4242"] = p1p2_only(A["wf26_A2_base_s4242"], A["wf26_A0_base_s4242"], idx)
    rep["crisis_26"] = contrast(A["wf26_A2_crisis_s42"], A["wf26_A0_crisis_s42"], idx)
    rep["did_26"] = did(A["wf26_A2_base_s42"], A["wf26_A0_base_s42"], A["wf26_A2_crisis_s42"], A["wf26_A0_crisis_s42"], idx)
    rep["A2_vs_A1"] = {rg: contrast(A[f"wf26_A2_{rg}_s42"], A[f"wf26_A1_{rg}_s42"], idx) for rg in REGIMES}
    rep["A1_vs_A0"] = {rg: p1p2_only(A[f"wf26_A1_{rg}_s42"], A[f"wf26_A0_{rg}_s42"], idx) for rg in REGIMES}
    rep["h5"] = {rg: p1p2_only(A[f"wf5_A2_{rg}_s42"], A[f"wf5_A0_{rg}_s42"], idx) for rg in REGIMES}
    save(out, "main.json", rep)
    return rep


# ── §7: абляция ─────────────────────────────────────────────────────────────────────────────────────────
def stage_ablation(stand: Stand, out: Path, plans: dict, workers: int) -> dict:
    x26 = plans["plan26_A0"]["x"]
    jobs = [(f"abl_{n}_{rg}", "/api/optimize", eval_body(x26, "A2", rg, SEED, N_WF, H26, {"counterparty": ov}))
            for n, ov in ABLATION.items() for rg in REGIMES]
    res = stand.many(jobs, workers)
    idx = st.boot_indices(N_WF, B_BOOT, SEED)
    rep = {}
    for rg in REGIMES:
        a0 = arrays(stand.call(f"wf26_A0_{rg}_s42", "", {}))
        a2 = arrays(stand.call(f"wf26_A2_{rg}_s42", "", {}))
        singles = {n: arrays(res[f"abl_{n}_{rg}"]) for n in ABLATION}
        r = {n: p1p2_only(v, a0, idx) for n, v in singles.items()}
        r["all"] = p1p2_only(a2, a0, idx)
        boot_all = st.boot_cvar_delta_samples(a2["min_cash"], a0["min_cash"], BETA, idx)
        boot_sum = sum(st.boot_cvar_delta_samples(v["min_cash"], a0["min_cash"], BETA, idx) for v in singles.values())
        pt = r["all"]["P1_cvar_cmin"]["delta"] - sum(v["P1_cvar_cmin"]["delta"] for n, v in r.items() if n != "all")
        pb_all = a2["breach"][idx].mean(1) - a0["breach"][idx].mean(1)
        pb_sum = sum(v["breach"][idx].mean(1) - a0["breach"][idx].mean(1) for v in singles.values())
        ptb = r["all"]["P2_breach"]["delta"] - sum(v["P2_breach"]["delta"] for n, v in r.items() if n != "all")
        r["interaction"] = {"cvar_cmin": {"value": pt, "ci": list(np.quantile(boot_all - boot_sum, [.025, .975]))},
                            "p_breach": {"value": ptb, "ci": list(np.quantile(pb_all - pb_sum, [.025, .975]))}}
        r["cp"] = {n: cp_block(res[f"abl_{n}_{rg}"]) for n in ABLATION}
        rep[rg] = r
    save(out, "ablation.json", rep)
    return rep


# ── §10: условия оплаты ─────────────────────────────────────────────────────────────────────────────────
def term_variants(premium_weekly: float) -> dict:
    v = {f"phi{phi}_d{d}": {"fin_override": {"prepay_share": phi}, "counterparty": {"prepay_discount": d}}
         for phi in (0, 0.25, 0.5, 1.0) for d in (0, 0.02)}
    v["dso_0_1"] = {"fin_override": {"dso_kernel": [0, 1]}}
    v["dso_0_0_.5_.5"] = {"fin_override": {"dso_kernel": [0, 0, 0.5, 0.5]}}
    v["security_0.9"] = {"counterparty": {"buyer_security_share": 0.9}, "fin_override": {"other_fixed_weekly": premium_weekly}}
    return v


def security_premium(stand: Stand) -> dict:
    """Премия обеспечения 0.2 % выручки [К] как постоянный недельный платёж: выручка без НДС плана x* в A2 base
    (из ECL: выставлено с НДС = списания / доля ECL), делённая на горизонт."""
    cp = cp_block(stand.call("wf26_A2_base_s42", "", {}))
    rev_vat = cp["bad_debt_mean"] / (cp["ecl_pct_revenue"] / 100.0)
    rev = rev_vat / 1.22
    return {"revenue_ex_vat": rev, "premium_total": 0.002 * rev, "premium_weekly": 0.002 * rev / 26}


def stage_terms(stand: Stand, out: Path, plans: dict, workers: int) -> dict:
    x26 = plans["plan26_A0"]["x"]
    prem = security_premium(stand)
    variants = term_variants(prem["premium_weekly"])
    jobs = [(f"terms_{arm}_{rg}_{n}", "/api/optimize", eval_body(x26, arm, rg, SEED, N_WF, H26, ov))
            for n, ov in variants.items() for arm in ("A0z", "A2") for rg in REGIMES]
    res = stand.many(jobs, workers)
    A = {k: arrays(v) for k, v in res.items()}
    idx = st.boot_indices(N_WF, B_BOOT, SEED)
    rep = {"premium": prem, "variants": variants, "effects": {}}
    for rg in REGIMES:
        for n in variants:
            row = {}
            for arm in ("A0z", "A2"):
                a, b = A[f"terms_{arm}_{rg}_{n}"], A[f"terms_{arm}_{rg}_phi0_d0"]
                row[arm] = p1p2_only(a, b, idx)
            d = {}
            for key, beta in (("min_cash", BETA), ("profit", None)):
                f = (lambda x, y: st.boot_cvar_delta_samples(x, y, beta, idx)) if beta else \
                    (lambda x, y: x[idx].mean(1) - y[idx].mean(1))
                e2 = f(A[f"terms_A2_{rg}_{n}"][key], A[f"terms_A2_{rg}_phi0_d0"][key])
                e0 = f(A[f"terms_A0z_{rg}_{n}"][key], A[f"terms_A0z_{rg}_phi0_d0"][key])
                pt_key = "P1_cvar_cmin" if beta else "E_profit"
                pt = row["A2"][pt_key]["delta"] - row["A0z"][pt_key]["delta"]
                d["cvar_cmin" if beta else "E_profit"] = {"did": pt, "ci": list(np.quantile(e2 - e0, [.025, .975]))}
            row["did_A2_minus_A0"] = d
            rep["effects"][f"{rg}/{n}"] = row
    save(out, "terms.json", rep)
    return rep


# ── §14: чувствительность ───────────────────────────────────────────────────────────────────────────────
def stage_sens(stand: Stand, out: Path, plans: dict, workers: int) -> dict:
    x26 = plans["plan26_A0"]["x"]
    jobs = [(f"sens_{n}", "/api/optimize", eval_body(x26, "A2", "base", SEED, N_WF, H26, {"counterparty": ov}))
            for n, ov in SENS.items()]
    res = stand.many(jobs, workers)
    a0 = arrays(stand.call("wf26_A0_base_s42", "", {}))
    idx = st.boot_indices(N_WF, B_BOOT, SEED)
    rep = {n: {**p1p2_only(arrays(res[f"sens_{n}"]), a0, idx), "override": SENS[n],
               "ecl_pct_revenue": cp_block(res[f"sens_{n}"]).get("ecl_pct_revenue")} for n in SENS}
    rep["default"] = p1p2_only(arrays(stand.call("wf26_A2_base_s42", "", {})), a0, idx)
    save(out, "sens.json", rep)
    return rep


# ── §9: ценность учёта контрагентов (аналог VSS) ────────────────────────────────────────────────────────
def stage_vss(stand: Stand, out: Path, plans: dict, workers: int) -> dict:
    s2 = SEED + SEED_VSS_SHIFT
    jobs = [(f"vss_{p}_{rg}", "/api/optimize", eval_body(plans[p]["x"], "A2", rg, s2, N_WF, H26))
            for p in ("plan26_A0", "plan26_A2") for rg in REGIMES]
    res = stand.many(jobs, workers)
    idx = st.boot_indices(N_WF, B_BOOT, s2)
    rep = {}
    for rg in REGIMES:
        a, b = arrays(res[f"vss_plan26_A2_{rg}"]), arrays(res[f"vss_plan26_A0_{rg}"])
        rep[rg] = {"cvar_profit": st.delta_cvar(a["profit"], b["profit"], ALPHA, idx),
                   "cvar_cmin": st.delta_cvar(a["min_cash"], b["min_cash"], BETA, idx),
                   "E_profit": st.delta_mean(a["profit"], b["profit"], idx),
                   "P_breach": st.newcombe10(a["breach"], b["breach"])}
    rep["seed"] = s2
    save(out, "vss.json", rep)
    return rep


# ── Манифест и сводка ───────────────────────────────────────────────────────────────────────────────────
def file_sha(p: Path) -> str | None:
    return hashlib.sha256(p.read_bytes()).hexdigest() if p.exists() else None


def git(*args: str) -> str:
    return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True).stdout


def manifest(out: Path, binary: Path, db: Path, ports: list[int]) -> dict:
    import requests
    from rl.eval.cr_e1_core import LOGIN
    tok = requests.post(f"http://127.0.0.1:{ports[0]}/api/auth/login", json=LOGIN, timeout=30).json()["data"]["token"]
    h = {"Authorization": f"Bearer {tok}"}
    pas = requests.get(f"http://127.0.0.1:{ports[0]}/api/passport", headers=h, timeout=60).json()["data"]["params"]
    fin = requests.get(f"http://127.0.0.1:{ports[0]}/api/fin_params", headers=h, timeout=60).json()["data"]
    keep = [r for r in pas if r["code"].startswith("fin.") or r["code"].startswith("macro.")]
    m = {"git_head": git("rev-parse", "HEAD").strip(),
         "git_diff_sha256": hashlib.sha256(git("diff", "HEAD").encode()).hexdigest(),
         "untracked": git("ls-files", "--others", "--exclude-standard", "backend", "rl").split(),
         "binary": str(binary), "binary_sha256": file_sha(binary), "db": str(db), "db_sha256": file_sha(db),
         "ports": ports, "seed": SEED, "seed_replicate": SEED_REP, "streams": {"macro": [SEED, 871], "bridge": [SEED, 872],
                                                                            "counterparty": [SEED, 915], "legacy_pd": "seed + 911 (mt19937)"},
         "N": {"waterfall": N_WF, "plan": N_PLAN, "lp_point": N_LP, "lp_replication": N_REP, "replication_seeds": REP_SEEDS,
               "bootstrap_B": B_BOOT},
         "horizons": {"primary": H26, "secondary": H5}, "regimes": REGIMES, "arms": ARMS, "beta": BETA, "alpha": ALPHA,
         "fin_params": fin, "passport": keep, "created": time.strftime("%Y-%m-%d %H:%M:%S %Z")}
    save(out, "manifest.json", m)
    return m


def timings(out: Path) -> dict:
    """Время по этапам: стена запроса (с) и total_ms денежного слоя."""
    agg: dict[str, list[float]] = {}
    for f in sorted((out / "raw").glob("*.json")):
        r = json.loads(f.read_text())
        if "wall_s" not in r:
            continue
        agg.setdefault(f.stem.split("_")[0], []).append(r["wall_s"])
    return {k: {"n": len(v), "mean_s": float(np.mean(v)), "max_s": float(np.max(v)), "sum_s": float(np.sum(v))}
            for k, v in agg.items()}


def run_stage(name: str, stand: Stand | None, out: Path, args) -> None:
    from rl.eval import cr_e1_gen, cr_e1_lp
    plans = load(out, "plans.json")
    w = len(args.ports)
    t0 = time.time()
    if name == "gate":
        r = stage_gate(stand, out, Path(args.golden))
        if not r["pass"]:
            raise SystemExit("Гейт 0 не пройден — стоп (§2).")
    elif name == "plan":
        stage_plan(stand, out)
    elif name == "main":
        stage_main(stand, out, plans, w)
    elif name == "ablation":
        stage_ablation(stand, out, plans, w)
    elif name == "terms":
        stage_terms(stand, out, plans, w)
    elif name == "sens":
        stage_sens(stand, out, plans, w)
    elif name == "vss":
        stage_vss(stand, out, plans, w)
    elif name == "stage1":
        prog = cr_e1_lp.program_of(stand.call("plan26_A0", "", {}), H26["horizon_hours"])
        save(out, "stage1.json", cr_e1_lp.stage1(stand, prog))
    elif name == "lp":
        save(out, "lp.json", cr_e1_lp.stage_lp(stand, w))
    elif name == "gencheck":
        rho = cp_block(stand.call("wf26_A2_base_s42", "", {}))["default_corr"]["rho"]
        save(out, "gencheck.json", cr_e1_gen.stage_gencheck(rho))
    elif name == "manifest":
        manifest(out, Path(args.binary), Path(args.db), args.ports)
    elif name == "summary":
        from rl.eval.cr_e1_report import render
        save(out, "timings.json", timings(out))
        parts = {n: load(out, f"{n}.json") for n in ("gate0", "plans", "main", "ablation", "terms", "sens", "vss", "stage1",
                                                     "lp", "gencheck", "timings", "manifest")}
        save(out, "summary.json", {k: v for k, v in parts.items() if v is not None})
        (out / "summary.md").write_text(render(out), encoding="utf-8")
    print(f"{name}: {time.time() - t0:.1f} с", flush=True)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", required=True)
    ap.add_argument("--ports", default="8091", type=lambda s: [int(x) for x in s.split(",")])
    ap.add_argument("--golden", default="")
    ap.add_argument("--binary", default="")
    ap.add_argument("--db", default="")
    ap.add_argument("stages", nargs="+")
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    stand = Stand(args.ports, out / "raw")
    for s in args.stages:
        run_stage(s, stand, out, args)


if __name__ == "__main__":
    main()
