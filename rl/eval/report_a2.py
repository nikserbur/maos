"""Таблицы отчёта A2 (markdown) из rl/results/{v5_a2,a2_headroom,a2_expost_bound}.json.

    rl/.venv/bin/python -m rl.eval.report_a2 > /tmp/a2_tables.md
"""
from __future__ import annotations

import json

from rl.train.common import RESULTS

MAIN = ["champion", "CPSAT", "GA", "oracle", "L0rule_bc_seed1", "L0rule_seed1", "L0rule_seed2", "L0rule_seed3",
        "L0rule_p0_seed1", "L0rule_p0_seed2", "L0rule_p0_seed3", "L0rule_last_seed1", "L0rule_p0_last_seed1"]


def fmt_ci(d: dict, k: str = "d_cvar_profit", scale: float = 100.0) -> str:
    x = d[k]
    return f"{x['iqm'] * scale:+.4f} [{x['ci95'][0] * scale:+.4f}; {x['ci95'][1] * scale:+.4f}]"


def v5_tables() -> None:
    d = json.loads((RESULTS / "v5_a2.json").read_text(encoding="utf-8"))
    for st, tab in d["tables"].items():
        print(f"\n**{st}** — N = {d['n']} сценариев × 12 экземпляров, holdout seed {d['holdout_seed']}\n")
        print("| Политика | ΔCVaR₀.₁(Π) к лучшему правилу, % E[Π] (IQM, 95 %-ДИ) | p | доля экз. > 0 | ΔCVaR₀.₀₅(C_min), % | к чемпиону, % | гейт |")
        print("|---|---|---|---|---|---|---|")
        for cand in MAIN:
            c = tab["comparisons"].get(cand)
            if not c:
                continue
            b = c["vs_best_rule"]
            ch = fmt_ci(c["vs_champion"]) if "vs_champion" in c else "—"
            print(f"| {cand} | {fmt_ci(b)} | {b['d_cvar_profit']['wilcoxon_p']:.3f} | {b['d_cvar_profit']['win_share']:.2f} | "
                  f"{b['d_cvar_cash']['iqm'] * 100:+.4f} | {ch} | {'да' if b['gate_pass'] else 'нет'} |")
        if "emergency" in tab:
            print("\nЭкстренное реагирование (шок − двойник без шока; разность кандидат − лучшее правило; среднее [95 %-ДИ] по парам экземпляр × сценарий):\n")
            print("| Политика | Δ время восстановления, ч | Δ просрочка от шока, ч | Δ потеря прибыли от шока, млн ₽ | Δ потеря min-кассы, млн ₽ | доля шоков, где лучше |")
            print("|---|---|---|---|---|---|")
            for cand in MAIN:
                e = tab["emergency"].get(cand)
                if not e:
                    continue
                f = lambda x, s=1.0: f"{x['mean'] * s:+.2f} [{x['ci95'][0] * s:+.2f}; {x['ci95'][1] * s:+.2f}]"  # noqa: E731
                print(f"| {cand} | {f(e['d_recovery_h'])} | {f(e['d_shock_tardiness_h'])} | {f(e['d_shock_profit_loss'], 1e-6)} | "
                      f"{f(e['d_shock_cash_loss'], 1e-6)} | {e['win_share']['mean']:.3f} [{e['win_share']['ci95'][0]:.3f}; {e['win_share']['ci95'][1]:.3f}] |")
    print("\nЧемпион гейта:", json.dumps(d["champion"], ensure_ascii=False))


def usage_table() -> None:
    d = json.loads((RESULTS / "v5_a2.json").read_text(encoding="utf-8"))
    for st in ("base", "shock"):
        u = d["tables"].get(st, {}).get("action_usage", {})
        print(f"\nДоли действий ({st}):\n")
        for pol in ("L0rule_seed3", "L0rule_p0_last_seed1", "L0rule_last_seed1", "oracle"):
            row = {n: v.get(pol, {}) for n, v in u.items()}
            print(f"- {pol}: " + "; ".join(f"{n}: " + ", ".join(f"{k} {x:.2f}" for k, x in sorted(r.items(), key=lambda t: -t[1])[:3])
                                         for n, r in row.items() if r))


def headroom_table() -> None:
    h = json.loads((RESULTS / "a2_headroom.json").read_text(encoding="utf-8"))
    b = json.loads((RESULTS / "a2_expost_bound.json").read_text(encoding="utf-8"))
    print("\n| Экземпляр | лучшее правило / чемпион (валидация) | оракул rush_expedite к лучшему правилу: base / shock, % | граница «ясновидящего» ΔCVaR, % | Δ среднего, % |")
    print("|---|---|---|---|---|")
    names = list(h["champions"])
    for i, n in enumerate(names):
        c = h["champions"][n]
        ob = h["holdout"]["base"]["oracle_vs_best_rule"]["d_cvar_profit"]["per_instance"][i] * 100
        osk = h["holdout"]["shock"]["oracle_vs_best_rule"]["d_cvar_profit"]["per_instance"][i] * 100
        print(f"| {n} | {c['best_rule']} / {c['champion']} | {ob:+.4f} / {osk:+.4f} | {b[n]['bound_d_cvar'] * 100:+.4f} | {b[n]['bound_d_mean'] * 100:+.3f} |")
    print("\nОракулы на валидации (средн. ΔCVaR к чемпиону, %):", {k: round(v * 100, 4) for k, v in h["oracle_val_scores"].items()})


if __name__ == "__main__":
    headroom_table()
    v5_tables()
    usage_table()
