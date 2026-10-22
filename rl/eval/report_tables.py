"""Таблицы Markdown из rl/results/*.json для отчёта A1 (детерминированно)."""
from __future__ import annotations

import json
from pathlib import Path

RESULTS = Path(__file__).resolve().parent.parent / "results"


def v4_table() -> str:
    d = json.loads((RESULTS / "v4_benchmarks.json").read_text(encoding="utf-8"))
    lines = ["| Экземпляр | операций | BKS | LB | лучшее правило (серийн.) | событийн. | ГА | CP-SAT (статус, с) | разрыв к BKS: правило / ГА / CP-SAT | разрыв к CP-SAT: правило / ГА |",
             "|---|---|---|---|---|---|---|---|---|---|"]
    for r in d["results"]:
        br = r["best_rule"]; rr = r["rules"][br]
        ev_best = min(r["rules"].values(), key=lambda x: x["event"])["event"]
        cp = r["cpsat"]; g = r.get("gap_bks_pct", {}); gc = r.get("gap_cpsat_pct", {})
        f = lambda v: "—" if v is None else f"{v:+.1f} %"
        lines.append(f"| {r['name']} | {r['n_jobs']} | {r['bks'] or '—'} | {r['lb'] if r['lb'] is not None else '—'} | {br} {rr['serial']:.0f} | {ev_best:.0f} | {r['ga']['makespan']:.0f} | "
                     f"{cp['makespan']:.0f} ({cp['status']}, {cp['sec']:.0f}) | {f(g.get('best_rule'))} / {f(g.get('ga'))} / {f(g.get('cpsat'))} | {f(gc.get('best_rule'))} / {f(gc.get('ga'))} |")
    return "\n".join(lines)


def v5_table(stress: str = "base") -> str:
    d = json.loads((RESULTS / "v5_results.json").read_text(encoding="utf-8"))
    t = d["tables"][stress]; lines = [f"**{stress}** — N = {d['n']} сценариев/экземпляр, экземпляров {len(d['instances'])}, доли режимов {t['regime_share']}", "",
                                      "| Политика | против | IQM ΔCVaR₀.₁(Π), доли E[Π] | 95 %-ДИ | p (Уилкоксон) | win | IQM ΔCVaR₀.₀₅(C_min) | ΔP(разрыв) | ΔE[Cmax], ч | гейт |", "|---|---|---|---|---|---|---|---|---|---|"]
    for cand, c in t["comparisons"].items():
        for ref, cc in c.items():
            p = cc["d_cvar_profit"]
            lines.append(f"| {cand} | {ref[3:]} | {p['iqm']:+.4f} | [{p['ci95'][0]:+.4f}; {p['ci95'][1]:+.4f}] | {p['wilcoxon_p']:.3f} | {p['win_share']:.2f} | "
                         f"{cc['d_cvar_cash']['iqm']:+.4f} | {cc['d_p_breach']['iqm']:+.3f} | {cc['d_makespan_h']['iqm']:+.1f} | {'да' if cc['gate_pass'] else 'нет'} |")
    return "\n".join(lines)


def v5_moves_table() -> str:
    d = json.loads((RESULTS / "v5_results.json").read_text(encoding="utf-8"))
    m = d["tables"]["base"]["metrics"]
    lines = ["| Политика | ходов/эпизод | доля эпизодов с ходами | виды ходов (сумма по экземплярам) |", "|---|---|---|---|"]
    for pol, by in m.items():
        if not pol.startswith("L2"):
            continue
        kinds: dict[str, int] = {}
        for n, x in by.items():
            for k, v in x["move_kinds"].items():
                kinds[k] = kinds.get(k, 0) + v
        lines.append(f"| {pol} | {sum(x['moves_per_episode'] for x in by.values()) / len(by):.2f} | {sum(x['share_episodes_with_moves'] for x in by.values()) / len(by):.2f} | {kinds} |")
    return "\n".join(lines)


if __name__ == "__main__":
    import sys
    what = sys.argv[1] if len(sys.argv) > 1 else "v4"
    print({"v4": v4_table, "v5": lambda: "\n\n".join(v5_table(s) for s in json.loads((RESULTS / 'v5_results.json').read_text())['tables']), "moves": v5_moves_table}[what]())
