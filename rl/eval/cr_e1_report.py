"""CR-E1 — Markdown-сводка из JSON этапов (числа в отчёт K1 не переписываются руками; деньги — млн ден. ед. демо,
как в M1; доли — %, разности долей — п.п.). Вызов: этап summary раннера rl/eval/cr_e1.py."""
from __future__ import annotations

import json
from pathlib import Path


def mln(x: float, d: int = 2) -> str:
    return f"{x / 1e6:.{d}f}".replace("-", "−")


def ci_mln(c: list, d: int = 2) -> str:
    return f"[{mln(c[0], d)}; {mln(c[1], d)}]"


def pct(x: float, d: int = 2) -> str:
    return f"{100 * x:.{d}f}".replace("-", "−")


def ci_pct(c: list, d: int = 2) -> str:
    return f"[{pct(c[0], d)}; {pct(c[1], d)}]"


def pv(p: float) -> str:
    return "< 0.0005" if p == 0 else f"{p:.3g}"


def render(E: Path) -> str:
    """Все таблицы сводки (этапы, которых нет на диске, пропускаются)."""
    lines: list[str] = []
    emit = lines.append
    J = lambda n: json.loads((E / n).read_text())  # noqa: E731
    m = J("main.json")

    emit("### arms")
    emit("| Прогон | CVaR₀.₀₅(C_min), млн | P(разрыв), % [Уилсон] | E[Π], млн | CVaR₀.₁(Π), млн | Проценты, тыс. | E[пик долга], млн | q₀.₀₅ DSCR | P(ковенант) | t_breach p10 |")
    emit("|---|---|---|---|---|---|---|---|---|---|")
    for k, a in m["arms"].items():
        w = a["waterfall_rule"]
        emit(f"| {k} | {mln(a['cvar_cmin'])} | {pct(a['p_breach'])} {ci_pct(a['p_breach_wilson'])} | {mln(a['E_profit'],1)} | {mln(a['cvar_profit'],1)} | {a['interest_mean']/1e3:.1f} | {mln(a['max_debt_mean'])} | {w['dscr_min_p05']:.0f} | {w['p_covenant']:.3f} | {w['t_breach_p10']:.0f} |")

    def prim_row(name, c):
        p1, p2 = c["P1_cvar_cmin"], c["P2_breach"]
        s = f"| {name} | {mln(p1['delta'])} {ci_mln(p1['ci'])} | {pv(p1['p_boot'])} | {pct(p2['p1'])} vs {pct(p2['p2'])} | {pct(p2['delta'])} {ci_pct(p2['ci'])} | {p2['discordant'][0]}/{p2['discordant'][1]} | {pv(p2['p_mcnemar'])} |"
        if "E_profit" in c: s += f" {mln(c['E_profit']['delta'])} {ci_mln(c['E_profit']['ci'])} |"
        return s
    emit("\n### primary & co")
    emit("| Контраст | ΔCVaR₀.₀₅(C_min), млн [95 % ДИ] | p (бутстреп) | P(разрыв), % (a vs b) | ΔP, п.п. [Ньюкомб] | несогл. пары a/b | p Мак-Немар | ΔE[Π], млн |")
    emit("|---|---|---|---|---|---|---|---|")
    emit(prim_row("A2 − A0, base, 26 нед., seed 42 (первичный)", m["primary_base_26"]))
    emit(prim_row("то же, seed 4242 (устойчивость)", m["replicate_seed4242"]))
    emit(prim_row("A2 − A0, crisis, 26 нед.", m["crisis_26"]))
    for rg in ("base", "crisis"):
        emit(prim_row(f"A2 − A1, {rg}, 26 нед.", m["A2_vs_A1"][rg]))
    for rg in ("base", "crisis"):
        emit(prim_row(f"A1 − A0, {rg}, 26 нед.", m["A1_vs_A0"][rg]))
    for rg in ("base", "crisis"):
        emit(prim_row(f"A2 − A0, {rg}, 5 нед.", m["h5"][rg]))
    p = m["primary_base_26"]
    hp = {k: ("< 0.001" if v == 0 else f"{v:.3g}") for k, v in p["holm"].items()}
    emit(f"\nBCa-проверка P1: {ci_mln(p['P1_cvar_cmin']['ci_bca'])}; p с поправкой Холма: P1 {hp['P1']}, P2 {hp['P2']}")
    emit("\n### secondary")
    emit("| Исход | base: A2 − A0 [95 % ДИ] | crisis: A2 − A0 [95 % ДИ] |")
    emit("|---|---|---|")
    for key, lab, f in (("E_profit", "ΔE[Π], млн", "m"), ("cvar_profit", "ΔCVaR₀.₁(Π), млн", "m"), ("q05_dscr", "Δq₀.₀₅ DSCR", "r"),
                        ("p_covenant", "ΔP(DSCR < 1.2), п.п.", "p"), ("max_debt_mean", "ΔE[пик долга], млн", "m"), ("max_debt_q95", "Δq₀.₉₅ пика долга, млн", "m"),
                        ("interest", "ΔE[проценты], тыс.", "k")):
        cells = []
        for rg in ("primary_base_26", "crisis_26"):
            v = m[rg][key]
            if f == "m": cells.append(f"{mln(v['delta'])} {ci_mln(v['ci'])}")
            elif f == "k": cells.append(f"{v['delta']/1e3:.1f} [{v['ci'][0]/1e3:.1f}; {v['ci'][1]/1e3:.1f}]".replace("-", "−"))
            elif f == "p": cells.append(f"{pct(v['delta'])} {ci_pct(v['ci'])}")
            else: cells.append(f"{v['delta']:.0f} [{v['ci'][0]:.0f}; {v['ci'][1]:.0f}]".replace("-", "−"))
        emit(f"| {lab} | {cells[0]} | {cells[1]} |")
    d = m["did_26"]
    emit("\nDiD: " + str({k: (mln(v['did']) if k != 'p_breach' else pct(v['did']), ci_mln(v['ci']) if k != 'p_breach' else ci_pct(v['ci'])) for k, v in d.items()}))

    a = J("ablation.json")
    emit("\n### ablation")
    emit("| Канал (A2, остальные вероятности = 0) | base: ΔCVaR₀.₀₅(C_min), млн | base: ΔP, п.п. | base: ΔE[Π], млн | crisis: ΔCVaR, млн | crisis: ΔP, п.п. | crisis: ΔE[Π], млн |")
    emit("|---|---|---|---|---|---|---|")
    names = {"only_late": "только просрочки покупателей", "only_buyer_default": "только дефолты покупателей", "only_supplier_default": "только дефолты поставщиков", "only_disrupt": "только срывы поставок (сдвиг отгрузок)", "all": "всё вместе (= A2)"}
    for n, lab in names.items():
        cells = []
        for rg in ("base", "crisis"):
            v = a[rg][n]
            cells += [f"{mln(v['P1_cvar_cmin']['delta'])} {ci_mln(v['P1_cvar_cmin']['ci'])}", f"{pct(v['P2_breach']['delta'])} {ci_pct(v['P2_breach']['ci'])}", f"{mln(v['E_profit']['delta'])} {ci_mln(v['E_profit']['ci'])}"]
        emit(f"| {lab} | " + " | ".join(cells) + " |")
    cells = []
    for rg in ("base", "crisis"):
        v = a[rg]["interaction"]
        cells += [f"{mln(v['cvar_cmin']['value'])} {ci_mln(v['cvar_cmin']['ci'])}", f"{pct(v['p_breach']['value'])} {ci_pct(v['p_breach']['ci'])}", "—"]
    emit("| взаимодействие = всё − Σ одиночных | " + " | ".join(cells) + " |")

    t = J("terms.json")
    emit("\n### terms; premium " + str({k: mln(v) for k, v in t["premium"].items()}))
    emit("| Вариант | Режим | A0: ΔCVaR(C_min), млн | A0: ΔP, п.п. | A0: ΔE[Π], млн | A2: ΔCVaR(C_min), млн | A2: ΔP, п.п. | A2: ΔE[Π], млн | DiD ΔCVaR (A2 − A0), млн | DiD ΔE[Π], млн |")
    emit("|---|---|---|---|---|---|---|---|---|---|")
    for key, row in t["effects"].items():
        rg, n = key.split("/")
        if n == "phi0_d0": continue
        c = []
        for arm in ("A0z", "A2"):
            v = row[arm]
            c += [f"{mln(v['P1_cvar_cmin']['delta'])} {ci_mln(v['P1_cvar_cmin']['ci'])}", f"{pct(v['P2_breach']['delta'],1)} {ci_pct(v['P2_breach']['ci'],1)}", f"{mln(v['E_profit']['delta'])}"]
        dd = row["did_A2_minus_A0"]
        c += [f"{mln(dd['cvar_cmin']['did'])} {ci_mln(dd['cvar_cmin']['ci'])}", f"{mln(dd['E_profit']['did'])} {ci_mln(dd['E_profit']['ci'])}"]
        emit(f"| {n} | {rg} | " + " | ".join(c) + " |")

    s = J("sens.json")
    emit("\n### sens")
    emit("| Параметр (A2, base) | ΔCVaR₀.₀₅(C_min), млн [95 % ДИ] | ΔP(разрыв), п.п. [Ньюкомб] | ΔE[Π], млн | ECL, % выручки |")
    emit("|---|---|---|---|---|")
    for n, v in s.items():
        emit(f"| {n} {json.dumps(v.get('override', {}), ensure_ascii=False)} | {mln(v['P1_cvar_cmin']['delta'])} {ci_mln(v['P1_cvar_cmin']['ci'])} | {pct(v['P2_breach']['delta'])} {ci_pct(v['P2_breach']['ci'])} | {mln(v['E_profit']['delta'])} | {v.get('ecl_pct_revenue') if v.get('ecl_pct_revenue') is None else round(v['ecl_pct_revenue'],3)} |")

    v = J("vss.json")
    emit(f"\n### vss seed {v['seed']}")
    emit("| Режим | ΔCVaR₀.₁(Π), млн | ΔCVaR₀.₀₅(C_min), млн | ΔE[Π], млн | ΔP(разрыв), п.п. |")
    emit("|---|---|---|---|---|")
    for rg in ("base", "crisis"):
        r = v[rg]
        emit(f"| {rg} | {mln(r['cvar_profit']['delta'])} {ci_mln(r['cvar_profit']['ci'])} | {mln(r['cvar_cmin']['delta'])} {ci_mln(r['cvar_cmin']['ci'])} | {mln(r['E_profit']['delta'])} {ci_mln(r['E_profit']['ci'])} | {pct(r['P_breach']['delta'])} {ci_pct(r['P_breach']['ci'])} |")
    if (E / "stage1.json").exists():
        emit(stage1_table(J("stage1.json")))
    if (E / "gencheck.json").exists():
        emit(gencheck_table(J("gencheck.json")))
    if (E / "lp.json").exists():
        emit(lp_tables(J("lp.json")))
    return "\n".join(lines)


def stage1_table(s1: dict) -> str:
    """§11: Стадия 1 на программе x* (CPR вкл. − выкл.)."""
    out = [f"\n### stage1 (правило {s1['rule']}, заказов {s1['n_orders']}, джоб {s1['n_jobs']})",
           "| Режим | ΔE[ΣT], ч | ΔE[Cmax], ч | ΔCVaR₀.₁(Cmax + ½ΣT), ч [95 % ДИ] | доля сценариев со срывом | дефицитных материалов |",
           "|---|---|---|---|---|---|"]
    for rg in ("base", "crisis"):
        v = s1[rg]
        c = v["cvar10_obj"]
        out.append(f"| {rg} | {v['E_tardiness']['delta']:.3f} | {v['E_makespan']['delta']:.3f} | {c['delta']:.3f} "
                   f"[{c['ci'][0]:.3f}; {c['ci'][1]:.3f}] | {v['share_scenarios_delayed']:.3f} | {v['shortage_materials']} |")
    return "\n".join(out)


def gencheck_table(g: dict) -> str:
    """§13: реализованные частоты против модели (z по ошибке Монте-Карло между сценариями)."""
    out = [f"\n### gencheck (N = {g['n_scenarios']}, {g['weeks']} нед., seed {g['seed']})",
           "| Режим | Величина | Реализовано | Модель | SE | z |", "|---|---|---|---|---|---|"]
    for rg in ("calm", "crisis"):
        for k in ("buyer_default", "supplier_default", "late_share", "cohort_default_given_late"):
            v = g[rg][k]
            out.append(f"| {rg} | {k} | {v['realized']:.4f} | {v['model']:.4f} | {v['se']:.4f} | {v['z']:.2f} |")
        t = g[rg]["tail_alpha"]
        out.append(f"| {rg} | tail_alpha (ОМП, σ_g = {t['sigma_g']:.3f}) | {t['alpha_hat']:.3f} | {t['model']:.3f} | "
                   f"{t['se']:.3f} | {(t['alpha_hat'] - t['model']) / t['se']:.2f} |")
        c = g[rg]["default_corr"]
        out.append(f"| {rg} | default_corr (ρ_w = {c['rho_w']:.3f}) | {c['empirical']:.4f} | {c['model']:.4f} | — | — |")
    out.append(f"\nCRN между стадиями: {g['crn_cross_stage']}")
    return "\n".join(out)


def lp_tables(lp: dict) -> str:
    """§8: точечные PoL (N из lp.json) и метод многократных репликаций (t-интервалы, K = 10)."""
    out = [f"\n### lp (точечно N = {lp['n_point']}; сетка L, млн: " + ", ".join(mln(x) for x in lp["grid"]) + ")"]
    out.append("| Плечо/режим | L, млн | статус | PoL_CVaR, млн | PoL_E, млн | двойств. цена |")
    out.append("|---|---|---|---|---|---|")
    for k, pts in lp["pol_point"].items():
        for L, v in sorted(pts.items(), key=lambda kv: float(kv[0])):
            pc = "—" if v["pol_cvar"] is None else mln(v["pol_cvar"])
            pe = "—" if v["pol_e"] is None else mln(v["pol_e"])
            du = "—" if v.get("dual") is None else f"{v['dual']:.4g}"
            out.append(f"| {k} | {mln(float(L))} | {v['status']} | {pc} | {pe} | {du} |")
    out.append("\n| Режим | L, млн | ΔPoL_CVaR (A2 − A0), млн [t, 9 с. с.] | ΔPoL_E, млн [t] | PoL_CVaR A0 | PoL_CVaR A2 | K | несовм. A0/A2 |")
    out.append("|---|---|---|---|---|---|---|---|")
    for rg, rows in lp["mrp"].items():
        for L, r in sorted(rows.items(), key=lambda kv: float(kv[0])):
            c, e = r["pol_cvar"], r["pol_e"]
            if not c["delta"]:
                out.append(f"| {rg} | {mln(float(L))} | — | — | — | — | 0 | {r['infeasible']['A0']}/{r['infeasible']['A2']} |")
                continue
            out.append(f"| {rg} | {mln(float(L))} | {mln(c['delta']['mean'])} {ci_mln(c['delta']['ci'])} | "
                       f"{mln(e['delta']['mean'])} {ci_mln(e['delta']['ci'])} | {mln(c['A0']['mean'])} | {mln(c['A2']['mean'])} | "
                       f"{c['k']} | {r['infeasible']['A0']}/{r['infeasible']['A2']} |")
    return "\n".join(out)
