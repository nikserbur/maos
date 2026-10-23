/**
 * Словарь структурных ходов агента (UX-V2 §4.7.1): подпись в UI, что меняется в плане и
 * жёсткая маска (ограничение, которое агент не может нарушить, RL-METHODOLOGY-PROPOSAL §3).
 * Один словарь на панель ходов, карточку полномочий и экран «Агенты». Доступность на демо-НСИ —
 * по отчёту A1 §4: `reroute/reassign/outsource` реализованы в среде, но маскированы (нет данных);
 * `transfer/drop` — волна 2; `shift_plus/shift_minus` бэкенда сводятся к `shift`.
 */
import type { MoveKind } from '../../../lib/api'

/** Готовность хода: реализован · требует данных НСИ · в плане (волна 2). */
export type MoveReadiness = 'done' | 'nsi' | 'planned'

export interface MoveKindMeta {
  kind: MoveKind
  label: string
  /** Что меняется в плане. */
  what: string
  /** Жёсткая маска — объяснение одной строкой. */
  mask: string
  /** Уровень агента: L0 — диспетчер (порядок), L2 — планировщик (структура). */
  level: 'L0' | 'L2'
  readiness: MoveReadiness
  /** Почему недоступен (для `nsi`/`planned`). */
  note?: string
}

/** Канонические виды в порядке таблицы §4.7.1 (без синонимов бэкенда). */
export const MOVE_KINDS: readonly MoveKindMeta[] = [
  { kind: 'reorder', label: 'Перестановка', what: 'порядок операций и заказов (как правило или ГА)', mask: 'предшествование и входы — всегда', level: 'L0', readiness: 'done' },
  { kind: 'reassign', label: 'Другой станок / тип РЦ', what: 'допустимый тип или станок операции', mask: 'только допустимые типы и допущенные рабочие', level: 'L2', readiness: 'nsi',
    note: 'у операций демо-НСИ один допустимый тип' },
  { kind: 'reroute', label: 'Другой маршрут', what: 'техкарта изделия → альтернативная (is_default = 0)', mask: 'только действующие техкарты изделия', level: 'L2', readiness: 'nsi',
    note: 'альтернативных техкарт в демо-НСИ нет' },
  { kind: 'split', label: 'Дробить партию', what: 'число партий запуска N′ и транспортные партии', mask: 'в пределах min–max партии изделия', level: 'L2', readiness: 'done' },
  { kind: 'merge', label: 'Объединить партии', what: 'слияние партий одного заказа', mask: 'в пределах min–max партии изделия', level: 'L2', readiness: 'done' },
  { kind: 'transfer', label: 'Перенести в цех', what: 'цех (org_unit) операции', mask: 'в цехе есть тип РЦ · транспорт между цехами', level: 'L2', readiness: 'planned', note: 'волна 2 (Р5)' },
  { kind: 'outsource', label: 'Отдать на сторону', what: 'операция или полуфабрикат → закупка по цене и сроку поставщика', mask: 'есть поставщик с ценой и сроком в НСИ; лимит доли себестоимости', level: 'L2', readiness: 'nsi',
    note: 'у изделий демо-НСИ нет полуфабрикатов во входах' },
  { kind: 'shift', label: 'Сдвинуть запуск', what: 'release_hours заказа (±1 неделя за ход)', mask: 'не раньше сегодня и поставок MRP; не позже срока минус цикл', level: 'L2', readiness: 'done' },
  { kind: 'drop', label: 'Отказаться от заказа', what: 'заказ исключается — штраф и упущенная маржа', mask: 'не для заказов с флагом «обязательный»', level: 'L2', readiness: 'planned', note: 'волна 2 (Р5)' },
  { kind: 'finance', label: 'Транш / отсрочка', what: 'график траншей кредитной линии (25/50/100 % лимита), погашение', mask: 'лимит линии и ковенанты; d_t ≤ невыбранный лимит', level: 'L2', readiness: 'done' },
]

/** Синонимы бэкенда → канонический вид. */
export function canonicalKind(kind: MoveKind): MoveKind {
  return kind === 'shift_plus' || kind === 'shift_minus' ? 'shift' : kind
}

const BY_KIND: Readonly<Record<string, MoveKindMeta>> = Object.fromEntries(MOVE_KINDS.map((m) => [m.kind, m]))

export function moveKindMeta(kind: MoveKind): MoveKindMeta {
  const c = canonicalKind(kind)
  return BY_KIND[c] ?? { kind: c, label: c, what: '', mask: 'неизвестный вид хода', level: 'L2', readiness: 'planned' }
}

export function moveLabel(kind: MoveKind): string {
  const base = moveKindMeta(kind).label
  if (kind === 'shift_plus') return `${base} вперёд`
  if (kind === 'shift_minus') return `${base} раньше`
  return base
}

export const READINESS_LABEL: Readonly<Record<MoveReadiness, string>> = {
  done: 'реализовано', nsi: 'нужны данные НСИ', planned: 'в плане',
}
