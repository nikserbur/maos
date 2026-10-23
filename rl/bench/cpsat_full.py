"""Полная модель CP-SAT Стадии 1 для правила «CP-SAT» в продукте (PLAN-V2 §8 п.1, A2).

Отличие от rl/bench/cpsat.py (релаксация для V4): здесь моделируются ВСЕ ограничения ядра
SchedCore::sim_place, которые видит детерминированный план по средним длительностям:

- альтернативные станки (FJSP): необязательный интервал на пару (джоба, станок), ровно один
  присутствует; норма на типе — `dur_by_type` (пусто → `dur`);
- наладки при смене изделия (sequence-dependent): точная модель через AddCircuit по станку —
  дуга i→j с литералом a_ij, флаг наладки σ_j = first_j + Σ_{i: изделие_i ≠ изделие_j} a_ij;
  интервал джобы включает наладку (как в sim_place: станок занят с начала наладки). Если у станка
  при свободной маршрутизации > CIRCUIT_MAX кандидатов, джобы, которые могут на него попасть, берут
  станок из подсказки (`routing = fixed_from_hint:N`), чтобы circuit остался точным; станки, где
  и так > CIRCUIT_MAX, — консервативная линеаризация σ_j = 1 (`setup_mode = conservative`);
- рабочие как cumulative-ресурс: общий (ёмкость = число рабочих) и по типу РЦ (ёмкость = число
  допущенных по матрице `eligible`); перекрытие множеств допусков между типами — релаксация,
  точное назначение рабочего делает sim_place при воспроизведении;
- календари: при ОДНОМ календаре на все станки (демо) — ось рабочего времени `Warp` (точная
  семантика sim_place: операция «растягивается» через перерыв, `calendar_mode = warp`); при
  индивидуальных графиках — запрещённые интервалы: нерабочие окна станка в его NoOverlap
  (операция целиком внутри смены; длиннее смены — средний коэффициент растяжения), станок 24×7
  (`any = false`) работает без перерывов (`calendar_mode = forbidden`);
- предшествование лотов/подпартий — граф `preds` из Expander (как в SchedCore) без изменений;
- «не раньше» запуска (`release`), поставки без станка (`wc_types` пусто) — интервал
  фиксированной длины без ресурса.

Тёплый старт: план правила-подсказки (sim_place по средним) исправляется под семантику модели
(`repair_hint`: целые длительности, наладки, окна, конкретный допущенный рабочий) и подаётся
ПОЛНОЙ подсказкой — солвер стартует с допустимого плана и улучшает его (LNS). Если за лимит
решения нет, возвращается исправленный план со статусом `HINT` (честно помечен).

Не моделируется: плановое ТО по наработке и поломки (стохастика) — их учитывает Монте-Карло
над пинами. Критерий: Cmax + w_tard·Σ просрочки заказов (мин) — та же структура, что F
Стадии 1 при w_time = 1 (Scheduler.cpp), чтобы «цена детерминизма» сравнивала сопоставимое.

Вход (`solve_payload`): JSON от backend (CpSatRule.cpp) — см. `payload_schema()`; либо
`{"instance": <Instance JSON SimEnv>}` — тогда развёртка в джобы через maos_env (стенд).
"""
from __future__ import annotations

import json
import math
import time
from dataclasses import dataclass, field

from ortools.sat.python import cp_model

CIRCUIT_MAX = 60          # [К] cpsat.circuit_max: кандидатов на станок для точной модели наладок
MAX_JOBS = 20000          # техн.: защита sidecar от неподъёмных запросов
MAX_TIME_LIMIT_S = 600.0  # техн.: потолок лимита солвера
WEEK_MIN = 7 * 24 * 60
LARGE_MODEL_JOBS = 1000   # [К] cpsat.large_jobs: крупная модель → presolve без пробинга/симметрий


def payload_schema() -> dict:
    """Описание входа sidecar (для GET /schema и документации)."""
    return {
        "name": "str", "time_limit_s": "float (лимит солвера, ≤ 600)", "workers": "int (потоков CP-SAT)",
        "seed": "int (random_seed солвера)", "w_tard": "float (вес Σ просрочки в критерии, по умолчанию 0.5)",
        "machines": [{"id": "str", "wct": "str"}],
        "calendar": {"any": "bool", "days": "7 × [[start_min, end_min], …]"},
        "machine_calendars": {"<machine id>": "calendar (any=false → 24×7)"},
        "n_workers": "int", "eligible": {"<wct>": "[индексы рабочих]"},
        "due_min": "[срок заказа k, мин]",
        "jobs": [{"order": "int", "op": "str", "product": "str", "wc_types": "[str]", "dur": "мин",
                  "dur_by_type": "[[wct, мин], …]", "setup": "мин", "preds": "[int]", "release": "мин",
                  "needs_worker": "bool"}],
        "hint": {"starts": "[мин]", "machines": "[str]", "makespan": "мин (сужает горизонт)"},
        "instance": "необязательно: Instance JSON SimEnv — если `jobs` нет, развёртка через maos_env",
    }


@dataclass
class FullResult:
    status: str
    objective: float = math.inf
    makespan: float = math.inf
    tardiness: float = 0.0
    bound: float = 0.0
    time_s: float = 0.0
    starts: list[float] = field(default_factory=list)
    machines: list[str] = field(default_factory=list)
    n_vars: int = 0
    n_jobs: int = 0
    setup_mode: str = "circuit"
    n_conservative: int = 0       # станков с консервативной наладкой (> CIRCUIT_MAX кандидатов)
    routing: str = "free"         # free | fixed_from_hint:<число джоб со станком из подсказки>
    calendar_mode: str = "forbidden"   # warp (единый календарь, рабочие минуты) | forbidden | none
    error: str = ""

    def to_json(self) -> dict:
        fin = lambda x: x if math.isfinite(x) else None  # noqa: E731
        return {"status": self.status, "objective": fin(self.objective), "makespan": fin(self.makespan),
                "tardiness": self.tardiness, "bound": self.bound, "time_s": self.time_s, "starts": self.starts,
                "machines": self.machines, "n_vars": self.n_vars, "n_jobs": self.n_jobs,
                "setup_mode": self.setup_mode, "n_conservative": self.n_conservative, "routing": self.routing,
                "calendar_mode": self.calendar_mode, "error": self.error}


# ── Календарь ────────────────────────────────────────────────────────────────
Days = list[list[tuple[int, int]]]


def _cal_days(cal: dict | None) -> Days | None:
    """Рабочие окна по дням недели; None → без ограничений (24×7)."""
    if not cal or not cal.get("any") or not cal.get("days"):
        return None
    days = [[(int(s), int(e)) for s, e in d] for d in cal["days"]][:7]
    while len(days) < 7:
        days.append([])
    return days if any(days) else None


def _weekly_work(days: Days) -> int:
    return sum(e - s for d in days for s, e in d)


def _longest_shift(days: Days) -> int:
    return max((e - s for d in days for s, e in d), default=0)


def _breaks(days: Days, horizon: int) -> list[tuple[int, int]]:
    """Нерабочие окна [a, b) на [0, horizon] — дополнение рабочих окон по дням (смежные слиты)."""
    out: list[tuple[int, int]] = []
    day = 0
    while day * 1440 < horizon:
        base, cur = day * 1440, day * 1440
        for s, e in sorted(days[day % 7]):
            if base + s > cur:
                out.append((cur, base + s))
            cur = max(cur, base + e)
        if cur < base + 1440:
            out.append((cur, base + 1440))
        day += 1
    merged: list[tuple[int, int]] = []
    for a, b in out:
        if merged and merged[-1][1] == a:
            merged[-1] = (merged[-1][0], b)
        else:
            merged.append((a, b))
    return merged



# ── Единый календарь: ось рабочего времени (точная семантика sim_place) ─────────
class Warp:
    """Отображение реального времени в рабочие минуты W(t) и обратно. sim_place «растягивает»
    операцию через перерывы (st = nextWork(t0), en = advance(st, работа)) — на оси рабочего
    времени это непрерывный интервал той же длины. Поэтому при ОДНОМ календаре на все станки
    модель решается без перерывов в рабочих минутах и переводится обратно — точнее, чем
    запрет пересечения перерывов (там операция обязана уложиться в одну смену)."""

    def __init__(self, days: Days) -> None:
        self.win = sorted((d * 1440 + s, d * 1440 + e) for d in range(7) for s, e in days[d] if e > s)
        self.cum, acc = [], 0
        for a, b in self.win:
            self.cum.append(acc)
            acc += b - a
        self.weekly = acc

    def fwd(self, t: float) -> int:
        """W(t): рабочих минут в [0, t)."""
        t = int(math.ceil(t - 1e-9))
        k, r = divmod(max(0, t), WEEK_MIN)
        return k * self.weekly + sum(min(max(0, r - a), b - a) for a, b in self.win)

    def _locate(self, w: int, at_end: bool) -> int:
        k, rem = divmod(max(0, w), self.weekly)
        if at_end and rem == 0 and k > 0:       # конец работы — в конце последнего окна недели
            k, rem = k - 1, self.weekly
        for (a, b), c0 in zip(self.win, self.cum):
            if rem < c0 + (b - a) or (at_end and rem == c0 + (b - a)):
                return k * WEEK_MIN + a + (rem - c0)
        return (k + 1) * WEEK_MIN + self.win[0][0]

    def start_of(self, w: float) -> float:
        """Реальный старт: рабочая минута w, снап к началу окна (как nextWork)."""
        return float(self._locate(int(round(w)), at_end=False))

    def end_of(self, w: float) -> float:
        """Реальный финиш: момент, когда накоплено w рабочих минут (как advance)."""
        return 0.0 if w <= 0 else float(self._locate(int(round(w)), at_end=True))


def _uniform_warp(p: dict) -> Warp | None:
    """Ось рабочего времени применима, если у всех станков один и тот же календарь."""
    if p.get("calendar_mode") == "forbidden":
        return None
    general = _cal_days(p.get("calendar"))
    if general is None:
        return None
    for cal in (p.get("machine_calendars") or {}).values():
        if _cal_days(cal) != general:
            return None
    return Warp(general)


def _warp_payload(p: dict, w: Warp) -> dict:
    """Вход в рабочих минутах: без календарей; релизы, сроки и старты подсказки — через W."""
    q = {**p, "calendar": {"any": False, "days": []}, "machine_calendars": {}}
    q["jobs"] = [{**j, "release": w.fwd(float(j.get("release", 0)))} for j in p["jobs"]]
    if p.get("due_min"):
        q["due_min"] = [w.fwd(d) if 0 < float(d) <= 1e9 else d for d in p["due_min"]]
    hint = p.get("hint") or {}
    if hint.get("starts"):
        q["hint"] = {**hint, "starts": [w.fwd(x) for x in hint["starts"]],
                     "makespan": w.fwd(float(hint.get("makespan") or 0))}
    return q


def _unwarp(res: "FullResult", ends: list[float], p: dict, w: Warp) -> None:
    """Старты/финиши обратно в реальное время; Cmax и просрочка — реальные."""
    res.starts = [w.start_of(x) for x in res.starts]
    real_end = [w.end_of(x) for x in ends]
    res.makespan = max(real_end, default=0.0)
    due = [float(x) for x in (p.get("due_min") or [])]
    fin: dict[int, float] = {}
    for i, j in enumerate(p["jobs"]):
        k = int(j.get("order", 0))
        fin[k] = max(fin.get(k, 0.0), real_end[i])
    res.tardiness = sum(max(0.0, f - due[k]) for k, f in fin.items() if k < len(due) and 0 < due[k] <= 1e9)
    res.calendar_mode = "warp"


# ── Модель ───────────────────────────────────────────────────────────────────
@dataclass
class _Ctx:
    p: dict
    jobs: list[dict]
    model: cp_model.CpModel
    horizon: int
    by_type: dict[str, list[str]]
    general: Days | None
    mcal: dict[str, Days | None]
    start: list = field(default_factory=list)
    end: list = field(default_factory=list)
    sigma: list = field(default_factory=list)
    pres: dict = field(default_factory=dict)          # i → {machine: presence}
    per_machine: dict = field(default_factory=dict)   # m → [(i, interval, short)]
    master: list = field(default_factory=list)
    setup_mode: str = "circuit"
    n_conservative: int = 0
    scaled: bool = False
    size: dict = field(default_factory=dict)          # i → IntVar длительности на выбранном станке
    circ: dict = field(default_factory=dict)          # m → литералы circuit (first/last/arc/unused)
    cmax: object = None
    repaired: dict | None = None                      # исправленная подсказка (полный тёплый старт)
    fixed: dict = field(default_factory=dict)         # i → станок (маршрутизация зафиксирована)
    fin: dict = field(default_factory=dict)           # заказ → IntVar финиша
    tard: dict = field(default_factory=dict)          # заказ → IntVar просрочки

    def cal_of(self, mid: str) -> Days | None:
        return self.mcal[mid] if mid in self.mcal else self.general


def validate_payload(p: dict) -> str:
    """Пустая строка — вход корректен; иначе текст ошибки (граница системы: вход недоверенный)."""
    if not isinstance(p, dict):
        return "вход — не объект JSON"
    jobs = p.get("jobs")
    if not isinstance(jobs, list) or not jobs:
        return "нет джоб (поле jobs)"
    if len(jobs) > MAX_JOBS:
        return f"слишком много джоб ({len(jobs)} > {MAX_JOBS})"
    n = len(jobs)
    for i, j in enumerate(jobs):
        if not isinstance(j, dict) or "dur" not in j:
            return f"джоба {i}: нет поля dur"
        try:
            if float(j["dur"]) < 0 or not math.isfinite(float(j["dur"])):
                return f"джоба {i}: некорректная длительность"
        except (TypeError, ValueError):
            return f"джоба {i}: dur не число"
        for q in j.get("preds") or []:
            if not isinstance(q, int) or not 0 <= q < n or q == i:
                return f"джоба {i}: некорректный предшественник {q!r}"
    if not isinstance(p.get("machines") or [], list):
        return "machines — не список"
    return ""


def _horizon(p: dict, jobs: list[dict], general: Days | None, mcal: dict) -> int:
    """Горизонт: Σ работы и наладок, растянутый по худшему календарю, + релизы; сужается подсказкой."""
    total = sum(math.ceil(float(j["dur"])) + math.ceil(float(j.get("setup", 0))) for j in jobs)
    rel_max = max((float(j.get("release", 0)) for j in jobs), default=0.0)
    stretch = 1.0
    for days in [general] + list(mcal.values()):
        if days:
            stretch = max(stretch, WEEK_MIN / max(1, _weekly_work(days)))
    horizon = int(math.ceil((total + rel_max) * stretch)) + WEEK_MIN
    hint_cmax = float((p.get("hint") or {}).get("makespan") or 0)
    if hint_cmax > 0:   # план правила — допустим, оптимум не хуже → запас ×1.5 + неделя
        horizon = min(horizon, int(math.ceil(hint_cmax * 1.5)) + WEEK_MIN)
    return max(horizon, 1)


def _options(j: dict, by_type: dict, cal_of, only: str | None = None) -> list[tuple[str, int, bool]]:
    """Допустимые станки джобы: (станок, длительность на нём с растяжением календаря, «короткая»).
    only — станок зафиксирован (маршрутизация из подсказки на крупной модели)."""
    setup = int(math.ceil(float(j.get("setup", 0))))
    dbt = {t: float(x) for t, x in (j.get("dur_by_type") or [])}
    out = []
    for t in [t for t in (j.get("wc_types") or []) if by_type.get(t)]:
        d_t = int(math.ceil(dbt.get(t, float(j["dur"]))))
        for mid in by_type[t]:
            if only is not None and mid != only:
                continue
            days = cal_of(mid)
            if days and d_t + setup > _longest_shift(days):   # не помещается в смену → растяжение
                out.append((mid, int(math.ceil(d_t * WEEK_MIN / max(1, _weekly_work(days)))), False))
            else:
                out.append((mid, d_t, True))
    return out


def _next_fit(days: Days, t: int, size: int) -> int:
    """Ближайший старт ≥ t, при котором [старт, старт+size] целиком в одном рабочем окне."""
    for d in range(t // 1440, t // 1440 + 22):
        base = d * 1440
        for s, e in sorted(days[d % 7]):
            t0 = max(t, base + s)
            if t0 + size <= base + e:
                return t0
    return t


def _topo_by_hint(jobs: list[dict], hs: list[float]) -> list[int]:
    """Топологический порядок джоб, среди готовых — по старту подсказки (как списочная схема)."""
    import heapq
    n = len(jobs)
    left = [len(j.get("preds") or []) for j in jobs]
    succ: list[list[int]] = [[] for _ in range(n)]
    for i, j in enumerate(jobs):
        for q in j.get("preds") or []:
            succ[int(q)].append(i)
    heap = [(float(hs[i]), i) for i in range(n) if left[i] == 0]
    heapq.heapify(heap)
    order = []
    while heap:
        _, i = heapq.heappop(heap)
        order.append(i)
        for s_ in succ[i]:
            left[s_] -= 1
            if left[s_] == 0:
                heapq.heappush(heap, (float(hs[s_]), s_))
    return order


def repair_hint(p: dict, by_type: dict, cal_of, conservative: set[str]) -> dict | None:
    """План-подсказку правила (sim_place по средним) → план, допустимый в семантике модели: целые
    длительности, наладка по смене изделия (консервативные станки — всегда), операция целиком в
    смене, конкретный допущенный рабочий (→ cumulative по типу и общий выполняются). Старт не раньше
    старта подсказки: порядок и маршрутизация правила сохраняются."""
    hint = p.get("hint") or {}
    jobs = p["jobs"]
    hs, hm = hint.get("starts") or [], hint.get("machines") or []
    if len(hs) != len(jobs):
        return None
    n = len(jobs)
    start, end, mach, sig = [0] * n, [0] * n, [""] * n, [0] * n
    mfree: dict[str, int] = {}
    mlast: dict[str, str] = {}
    n_workers = int(p.get("n_workers", 0))
    wfree = [0] * n_workers
    eligible = {k: list(v) for k, v in (p.get("eligible") or {}).items()}
    wct_of = {str(mc["id"]): str(mc["wct"]) for mc in p.get("machines") or []}
    for i in _topo_by_hint(jobs, hs):
        j = jobs[i]
        est = max(int(math.ceil(float(j.get("release", 0)))), int(math.ceil(float(hs[i]) - 1e-6)),
                  max((end[int(q)] for q in j.get("preds") or []), default=0))
        opts = _options(j, by_type, cal_of)
        if not opts:
            start[i], end[i] = est, est + max(0, int(math.ceil(float(j["dur"]))))
            continue
        pick = next((o for o in opts if i < len(hm) and o[0] == hm[i]), None) or min(opts, key=lambda o: mfree.get(o[0], 0))
        mid, d_eff, short = pick
        setup = int(math.ceil(float(j.get("setup", 0))))
        sig[i] = 1 if setup > 0 and (mid in conservative or mlast.get(mid) != j.get("product")) else 0
        size = d_eff + setup * sig[i]
        t = max(est, mfree.get(mid, 0))
        days = cal_of(mid)
        pool = [x for x in (eligible.get(wct_of.get(mid, "")) or range(n_workers)) if 0 <= x < n_workers] \
            if j.get("needs_worker", True) else []
        w = -1
        for _ in range(4 * n_workers + 8):        # сдвиг до свободного рабочего и рабочего окна
            if days and short:
                t = _next_fit(days, t, size)
            if not pool:
                break
            free = [x for x in pool if wfree[x] <= t]
            if free:
                w = min(free, key=lambda x: wfree[x])
                break
            t = max(t, min(wfree[x] for x in pool))
        if w >= 0:
            wfree[w] = t + size
        start[i], end[i], mach[i] = t, t + size, mid
        mfree[mid], mlast[mid] = end[i], j.get("product")
    return {"start": start, "end": end, "machine": mach, "sigma": sig}


def _add_job(c: _Ctx, i: int, j: dict) -> None:
    m = c.model
    m.Add(c.start[i] >= int(math.ceil(float(j.get("release", 0)))))
    types = [t for t in (j.get("wc_types") or []) if c.by_type.get(t)]
    d_main = max(0, int(math.ceil(float(j["dur"]))))
    setup = int(math.ceil(float(j.get("setup", 0))))
    if not types:                        # поставка/аутсорсинг: без станка и рабочего
        m.Add(c.end[i] == c.start[i] + d_main)
        c.master[i] = m.NewIntervalVar(c.start[i], d_main, c.end[i], f"iv{i}")
        return
    sig = m.NewBoolVar(f"sig{i}") if setup > 0 else None
    c.sigma[i] = sig
    c.pres[i] = {}
    size_terms = []
    for mid, d_eff, short in _options(j, c.by_type, c.cal_of, c.fixed.get(i)):
        pm = m.NewBoolVar(f"p{i}_{mid}")
        c.pres[i][mid] = pm
        size_terms.append((pm, d_eff))
        size = d_eff + (setup * sig if sig is not None else 0)
        iv = m.NewOptionalIntervalVar(c.start[i], size, c.end[i], pm, f"iv{i}_{mid}")
        c.per_machine.setdefault(mid, []).append((i, iv, short))
    m.AddExactlyOne(list(c.pres[i].values()))
    size = m.NewIntVar(0, c.horizon, f"sz{i}")       # длительность на выбранном станке + наладка
    m.Add(size == sum(pm * d for pm, d in size_terms) + (setup * sig if sig is not None else 0))
    c.size[i] = size
    c.master[i] = m.NewIntervalVar(c.start[i], size, c.end[i], f"ivm{i}")


def _add_machines(c: _Ctx) -> None:
    """NoOverlap по станку (+ перерывы календаря для «коротких» операций), наладки через circuit."""
    for mid, items in c.per_machine.items():
        c.model.AddNoOverlap([iv for _, iv, _ in items])
        days = c.cal_of(mid)
        if days:
            shorts = [iv for _, iv, s in items if s]
            if shorts:
                brk = [c.model.NewIntervalVar(a, b - a, b, f"brk{mid}_{a}") for a, b in _breaks(days, c.horizon)]
                c.model.AddNoOverlap(shorts + brk)
        need = [i for i, _, _ in items if c.sigma[i] is not None]
        if not need:
            continue
        if len(items) > CIRCUIT_MAX:            # консервативно: наладка всегда
            c.setup_mode = "conservative"
            c.n_conservative += 1
            for i in need:
                c.model.Add(c.sigma[i] == 1).OnlyEnforceIf(c.pres[i][mid])
            continue
        _add_setup_circuit(c, mid, items)


def _add_setup_circuit(c: _Ctx, mid: str, items: list) -> None:
    """Точная модель наладок на станке: гамильтонов цикл по присутствующим джобам с фиктивным узлом 0."""
    m, jobs = c.model, c.jobs
    nodes = [i for i, _, _ in items]
    idx = {i: k + 1 for k, i in enumerate(nodes)}
    unused = m.NewBoolVar(f"unused_{mid}")
    arcs = [(0, 0, unused)]
    first = {i: m.NewBoolVar(f"first_{mid}_{i}") for i in nodes}
    last = {i: m.NewBoolVar(f"last_{mid}_{i}") for i in nodes}
    arc_of: dict[tuple[int, int], object] = {}
    c.circ[mid] = {"unused": unused, "first": first, "last": last, "arc": arc_of}
    incoming_diff: dict[int, list] = {i: [] for i in nodes}
    for i in nodes:
        arcs.append((0, idx[i], first[i]))
        arcs.append((idx[i], 0, last[i]))
        arcs.append((idx[i], idx[i], c.pres[i][mid].Not()))     # петля = джоба не на этом станке
        m.AddImplication(unused, c.pres[i][mid].Not())
    for i in nodes:
        for j in nodes:
            if i == j:
                continue
            a = m.NewBoolVar(f"a_{mid}_{i}_{j}")
            arc_of[(i, j)] = a
            arcs.append((idx[i], idx[j], a))
            m.Add(c.start[j] >= c.end[i]).OnlyEnforceIf(a)
            if jobs[i].get("product") != jobs[j].get("product"):
                incoming_diff[j].append(a)
    m.AddCircuit(arcs)
    for j in nodes:
        if c.sigma[j] is not None:   # на этом станке: наладка ⇔ первый или предшественник другого изделия
            m.Add(c.sigma[j] == first[j] + sum(incoming_diff[j])).OnlyEnforceIf(c.pres[j][mid])


def _add_workers(c: _Ctx) -> None:
    n_workers = int(c.p.get("n_workers", 0))
    if n_workers <= 0:
        return
    eligible = {k: list(v) for k, v in (c.p.get("eligible") or {}).items()}
    needs = lambda i: c.jobs[i].get("needs_worker", True)  # noqa: E731
    glob = [c.master[i] for i in c.pres if needs(i)]
    if len(glob) > n_workers:
        c.model.AddCumulative(glob, [1] * len(glob), n_workers)
    for t, mids in c.by_type.items():
        cap = len(eligible[t]) if eligible.get(t) else n_workers
        ivs = [iv for mid in mids for i, iv, _ in c.per_machine.get(mid, []) if needs(i)]
        if ivs and cap < len(ivs):
            c.model.AddCumulative(ivs, [1] * len(ivs), max(1, cap))


def _add_objective(c: _Ctx):
    """Cmax + w_tard·Σ просрочки (целочисленно ×1000). Возвращает (cmax, [tard])."""
    m = c.model
    w_tard = float(c.p.get("w_tard", 0.5))
    due_min = [float(x) for x in (c.p.get("due_min") or [])]
    cmax = m.NewIntVar(0, c.horizon, "cmax")
    c.cmax = cmax
    m.AddMaxEquality(cmax, c.end)
    tards = []
    if due_min and w_tard > 0:
        last: dict[int, list] = {}
        for i, j in enumerate(c.jobs):
            last.setdefault(int(j.get("order", 0)), []).append(c.end[i])
        for k, ends in last.items():
            if k >= len(due_min) or due_min[k] <= 0 or due_min[k] > 1e9:
                continue
            fin = m.NewIntVar(0, c.horizon, f"fin{k}")
            m.AddMaxEquality(fin, ends)
            tard = m.NewIntVar(0, c.horizon, f"T{k}")
            m.Add(tard >= fin - int(math.ceil(due_min[k])))
            c.fin[k], c.tard[k] = fin, tard
            tards.append(tard)
    if tards:
        c.scaled = True
        m.Minimize(1000 * cmax + int(round(w_tard * 1000)) * sum(tards))
    else:
        m.Minimize(cmax)
    return cmax, tards


def _hint_objective(c: _Ctx, r: dict) -> tuple[int, dict[int, int], dict[int, int]]:
    """Cmax, финиши и просрочки заказов исправленного плана (для полной подсказки)."""
    due_min = [float(x) for x in (c.p.get("due_min") or [])]
    fin: dict[int, int] = {}
    for i, j in enumerate(c.jobs):
        k = int(j.get("order", 0))
        fin[k] = max(fin.get(k, 0), r["end"][i])
    tard = {k: max(0, fin[k] - int(math.ceil(due_min[k]))) for k in c.tard}
    return max(r["end"], default=0), fin, tard


def _add_full_hint(c: _Ctx, r: dict) -> None:
    """Полная подсказка (все переменные) — CP-SAT стартует с допустимого плана правила."""
    m = c.model
    for i in range(len(c.jobs)):
        m.AddHint(c.start[i], r["start"][i])
        m.AddHint(c.end[i], r["end"][i])
        if i in c.pres:
            m.AddHint(c.size[i], r["end"][i] - r["start"][i])
            for mid, pm in c.pres[i].items():
                m.AddHint(pm, 1 if mid == r["machine"][i] else 0)
            if c.sigma[i] is not None:
                m.AddHint(c.sigma[i], r["sigma"][i])
    for mid, cc in c.circ.items():
        seq = sorted((i for i in cc["first"] if r["machine"][i] == mid), key=lambda i: (r["start"][i], i))
        on = set(seq)
        m.AddHint(cc["unused"], 0 if seq else 1)
        for i in cc["first"]:
            m.AddHint(cc["first"][i], 1 if seq and i == seq[0] else 0)
            m.AddHint(cc["last"][i], 1 if seq and i == seq[-1] else 0)
        nxt = {seq[k]: seq[k + 1] for k in range(len(seq) - 1)}
        for (a, b), lit in cc["arc"].items():
            m.AddHint(lit, 1 if a in on and nxt.get(a) == b else 0)
    cmax, fin, tard = _hint_objective(c, r)
    m.AddHint(c.cmax, cmax)
    for k in c.tard:
        m.AddHint(c.fin[k], fin[k])
        m.AddHint(c.tard[k], tard[k])


def _add_hint(c: _Ctx) -> None:
    """Тёплый старт солвера — детерминированный план лучшего правила (исправленный → полный)."""
    if c.repaired is not None:
        _add_full_hint(c, c.repaired)
        return
    hint = c.p.get("hint") or {}
    hs, hm = hint.get("starts") or [], hint.get("machines") or []
    if len(hs) != len(c.jobs):
        return
    for i in range(len(c.jobs)):
        c.model.AddHint(c.start[i], int(round(float(hs[i]))))
        if i in c.pres and i < len(hm) and hm[i] in c.pres[i]:
            for mid, pm in c.pres[i].items():
                c.model.AddHint(pm, 1 if mid == hm[i] else 0)


def _fixed_routing(p: dict, jobs: list[dict], by_type: dict, cal_of) -> dict[int, str]:
    """Станки, зафиксированные по подсказке. Если при свободной маршрутизации у станка больше
    CIRCUIT_MAX кандидатов, наладки на нём пришлось бы считать консервативно (всегда) — это хуже
    самого правила (V4 A2: plan1 1063 ч против 934 ч). Поэтому джобы, которые могут попасть на такой
    станок, берут станок подсказки, а остальные выбираются солвером свободно. fix_machines=true/false
    в запросе — зафиксировать всё / ничего."""
    hm = (p.get("hint") or {}).get("machines") or []
    if len(hm) != len(jobs) or p.get("fix_machines") is False:
        return {}
    opts = [_options(j, by_type, cal_of) for j in jobs]
    count: dict[str, int] = {}
    setup_on: set[str] = set()                      # станки, где circuit нужен (есть кандидат с наладкой)
    for j, o in zip(jobs, opts):
        for mid, _, _ in o:
            count[mid] = count.get(mid, 0) + 1
            if float(j.get("setup", 0)) > 0:
                setup_on.add(mid)
    over = {mid for mid, k in count.items() if k > CIRCUIT_MAX and mid in setup_on}
    fix_all = bool(p.get("fix_machines"))
    out = {}
    for i, o in enumerate(opts):
        if len(o) > 1 and (fix_all or any(mid in over for mid, _, _ in o)) and any(mid == hm[i] for mid, _, _ in o):
            out[i] = hm[i]
    return out


def _build(p: dict) -> _Ctx:
    jobs = p["jobs"]
    n = len(jobs)
    by_type: dict[str, list[str]] = {}
    for mc in p.get("machines") or []:
        by_type.setdefault(str(mc["wct"]), []).append(str(mc["id"]))
    general = _cal_days(p.get("calendar"))
    mcal = {str(mid): _cal_days(cal) for mid, cal in (p.get("machine_calendars") or {}).items()}
    cal_of = lambda mid: mcal[mid] if mid in mcal else general  # noqa: E731
    fixed = _fixed_routing(p, jobs, by_type, cal_of)
    count: dict[str, int] = {}
    for i, j in enumerate(jobs):
        for mid, _, _ in _options(j, by_type, cal_of, fixed.get(i)):
            count[mid] = count.get(mid, 0) + 1
    repaired = repair_hint(p, by_type, cal_of, {mid for mid, k in count.items() if k > CIRCUIT_MAX})
    horizon = _horizon(p, jobs, general, mcal)
    if repaired is not None:   # исправленный план допустим → оптимум не хуже его критерия
        bound = max(repaired["end"], default=0) * (1.0 + float(p.get("w_tard", 0.5)) * len(p.get("due_min") or [1]))
        horizon = max(max(repaired["end"], default=0) + 1, min(horizon, int(math.ceil(bound)) + WEEK_MIN))
    model = cp_model.CpModel()
    c = _Ctx(p=p, jobs=jobs, model=model, horizon=horizon, by_type=by_type, general=general, mcal=mcal)
    c.repaired, c.fixed = repaired, fixed
    c.start = [model.NewIntVar(0, horizon, f"s{i}") for i in range(n)]
    c.end = [model.NewIntVar(0, horizon, f"e{i}") for i in range(n)]
    c.sigma, c.master = [None] * n, [None] * n
    for i, j in enumerate(jobs):
        _add_job(c, i, j)
    for i, j in enumerate(jobs):          # предшествование (лоты/подпартии/входы BOM — граф Expander)
        for q in j.get("preds") or []:
            model.Add(c.start[i] >= c.end[int(q)])
    _add_machines(c)
    _add_workers(c)
    return c


def _solver(p: dict, n_jobs: int) -> cp_model.CpSolver:
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = min(MAX_TIME_LIMIT_S, max(0.1, float(p.get("time_limit_s", 30.0))))
    solver.parameters.num_workers = max(1, min(16, int(p.get("workers", 8))))
    solver.parameters.random_seed = int(p.get("seed", 42))
    if n_jobs > LARGE_MODEL_JOBS:   # presolve крупной модели съедает лимит — время отдаём поиску (LNS от подсказки)
        solver.parameters.cp_model_probing_level = 0
        solver.parameters.symmetry_level = 0
    return solver


def _from_repaired(c: _Ctx, res: FullResult) -> list[float]:
    """Солвер не нашёл решения за лимит → исправленный план правила (честно: статус HINT)."""
    r = c.repaired
    cmax, _, tard = _hint_objective(c, r)
    w_tard = float(c.p.get("w_tard", 0.5)) if c.scaled else 0.0
    res.status = "HINT"
    res.error = "решение за лимит не найдено — возвращён исправленный план правила-подсказки"
    res.makespan, res.tardiness = float(cmax), float(sum(tard.values()))
    res.objective = cmax + w_tard * res.tardiness
    res.starts = [float(x) for x in r["start"]]
    res.machines = list(r["machine"])
    return [float(x) for x in r["end"]]


def solve_payload(p: dict) -> FullResult:
    t0 = time.time()
    if isinstance(p, dict) and not p.get("jobs") and p.get("instance"):
        p = {**payload_from_instance(p["instance"]), **{k: v for k, v in p.items() if k != "instance"}}
    why = validate_payload(p)
    if why:
        return FullResult("ERROR", error=why, time_s=time.time() - t0)
    warp = _uniform_warp(p)
    q = _warp_payload(p, warp) if warp else p
    c = _build(q)
    cmax, tards = _add_objective(c)
    _add_hint(c)
    solver = _solver(q, len(c.jobs))
    st = solver.Solve(c.model)
    res = FullResult(solver.StatusName(st), n_vars=len(c.model.Proto().variables), n_jobs=len(c.jobs),
                     setup_mode=c.setup_mode, n_conservative=c.n_conservative,
                     routing=f"fixed_from_hint:{len(c.fixed)}" if c.fixed else "free",
                     calendar_mode="forbidden" if (c.general or c.mcal) else "none")
    scale = 1000.0 if c.scaled else 1.0
    res.bound = solver.BestObjectiveBound() / scale if st != cp_model.UNKNOWN else 0.0
    ends: list[float] = []
    if st in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        res.objective = solver.ObjectiveValue() / scale
        res.makespan = float(solver.Value(cmax))
        res.tardiness = float(sum(solver.Value(t) for t in tards))
        res.starts = [float(solver.Value(s)) for s in c.start]
        ends = [float(solver.Value(e)) for e in c.end]
        res.machines = [next((mid for mid, pm in c.pres[i].items() if solver.Value(pm)), "") if i in c.pres else ""
                        for i in range(len(c.jobs))]
    elif st == cp_model.UNKNOWN and c.repaired is not None:
        ends = _from_repaired(c, res)
    if warp and res.starts:
        _unwarp(res, ends, p, warp)
    res.time_s = time.time() - t0
    return res


# ── Экземпляр SimEnv → вход модели (стенд V4) ────────────────────────────────
def payload_from_instance(inst_json: dict | str, use_calendar: bool = True) -> dict:
    """Instance JSON SimEnv → вход solve_payload: та же развёртка в джобы (Expander), что в продукте."""
    from rl.env.core import load_module, make_config
    me = load_module()
    text = inst_json if isinstance(inst_json, str) else json.dumps(inst_json)
    env = me.SimEnv(me.Instance.from_json(text),
                    make_config({"event_mode": False, "deterministic": True, "breakdowns": False, "dense_reward": False}))
    env.reset(1)
    jobs = json.loads(env.job_info())
    inst = json.loads(env.instance_to_json())
    due: dict[int, float] = {}
    for j in jobs:
        due[int(j["order"])] = max(due.get(int(j["order"]), 0.0), float(j.get("due", 0.0)))
    return {
        "name": inst.get("name", "instance"),
        "machines": [{"id": m["id"], "wct": m["wct"]} for m in inst["machines"]],
        "calendar": inst.get("calendar") if use_calendar else {"any": False, "days": []},
        "machine_calendars": inst.get("machine_calendars", {}) if use_calendar else {},
        "n_workers": len(inst.get("workers") or []), "eligible": inst.get("eligible") or {},
        "due_min": [due.get(k, 0.0) for k in range(len(inst.get("orders") or []))],
        "jobs": [{"order": j["order"], "op": j["op"], "product": j["product"], "wc_types": j["wc_types"],
                  "dur": j["dur"], "dur_by_type": j["dur_by_type"], "setup": j["setup"], "preds": j["preds"],
                  "release": j["release"], "needs_worker": j["needs_worker"]} for j in jobs],
    }
