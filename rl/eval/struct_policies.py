"""Неучащиеся структурные политики A3 (rl/eval/prereg_a3.md §4): статические и реактивные эвристики, правило
«инвестируй, если окупается», библиотека для ex-post оракула. Все — функции (obs[B,48], mask[B,13]) → действия;
решения принимаются только по НАБЛЮДАЕМОМУ состоянию (будущее сценария не используется).
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from rl.env.l3_env import A, F


def _pick(mask: np.ndarray, *cands: tuple[np.ndarray, int]) -> np.ndarray:
    """Первое допустимое действие из списка (условие, действие) по каждой строке; иначе noop."""
    out = np.zeros(len(mask), dtype=int)
    done = np.zeros(len(mask), dtype=bool)
    for cond, a in cands:
        ok = cond & mask[:, a] & ~done
        out[ok] = a
        done |= ok
    return out


@dataclass(frozen=True)
class Heuristic:
    """Пороговая реактивная политика (TOC: «защити узкое место»). Параметры (выбор — по валидации):
    ot — сверхурочные, если доля стоимости заказов с прогнозом просрочки > ot (или ρ_rem > 1, если ot_rho);
    out — субподряд операций узкого места, если доля > out; expedite — «срочный первым» при срочном заказе;
    draw — буфер ликвидности при кассе < draw·V и разрыве в прошлом; invest — (кандидаты, купить в неделю 0)."""
    name: str
    ot: float | None = None
    out: float | None = None
    expedite: bool = False
    draw: float | None = None
    ot_always: bool = False
    invest: tuple[int, ...] = field(default_factory=tuple)
    repay: bool = False          # «подметание кассы»: погашать линию излишком кассы на каждой эпохе (контроль A3, не в сетке)

    def __call__(self, obs: np.ndarray, mask: np.ndarray) -> np.ndarray:
        one = np.ones(len(obs), dtype=bool)
        lv = obs[:, F["late_value"]]
        wk0 = obs[:, F["week"]] <= 1e-9
        cands = []
        for c in self.invest:
            cands.append((wk0 & (obs[:, F["inv0"] + c] < 0.5), A[f"invest{c}"]))
        if self.expedite:
            cands.append((obs[:, F["rush_rem"]] > 0, A["dispatch_expedite"]))
        if self.ot_always:
            cands.append((obs[:, F["ot_active"]] < 0.5, A["overtime"]))
        if self.ot is not None:
            cands.append(((lv > self.ot) & (obs[:, F["ot_active"]] < 0.5), A["overtime"]))
        if self.out is not None:
            cands.append((lv > self.out, A["outsource_op"]))
        if self.draw is not None:
            cands.append(((obs[:, F["cash"]] < self.draw) & (obs[:, F["undrawn"]] > 0.05), A["draw"]))
        if self.repay:
            cands.append((one, A["repay"]))
        return _pick(mask, *cands) if cands else np.zeros(len(obs), dtype=int)


def heuristic_grid(invest: tuple[int, ...] = ()) -> list[Heuristic]:
    """Предрегистрированная сетка эвристик (выбор лучшей — по CVaR₀.₁(Π) на валидации)."""
    g = [Heuristic("noop"), Heuristic("ot_always", ot_always=True), Heuristic("expedite", expedite=True)]
    for t in (0.0, 0.1, 0.25):
        g.append(Heuristic(f"ot>{t}", ot=t))
        g.append(Heuristic(f"out>{t}", out=t))
        g.append(Heuristic(f"ot+out>{t}", ot=t, out=t, expedite=True))
    g.append(Heuristic("toc_full", ot=0.0, out=0.1, expedite=True, draw=0.02))
    if invest:
        g += [Heuristic(f"{h.name}+inv{''.join(map(str, invest))}", ot=h.ot, out=h.out, expedite=h.expedite, draw=h.draw,
                        ot_always=h.ot_always, invest=invest) for h in list(g)]
    return g


def invest_static(c: int) -> Heuristic:
    return Heuristic(f"invest{c}", invest=(c,))


def with_sweep(h: "Heuristic | None") -> Heuristic:
    """H* + «подметание кассы» (погашение линии излишком на каждой эпохе) — пост-хок контроль A3 (не предрегистрирован)."""
    if h is None:
        return Heuristic("noop+sweep", repay=True)
    return Heuristic(h.name + "+sweep", ot=h.ot, out=h.out, expedite=h.expedite, draw=h.draw, ot_always=h.ot_always,
                     invest=h.invest, repay=True)
