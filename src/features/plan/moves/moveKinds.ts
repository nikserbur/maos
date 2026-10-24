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
  { kind: 'reorder', label: 'Перестановка', what: 'порядок операций и заказов (как правило или генетический алгоритм)', mask: 'порядок операций техкарты и наличие входов — всегда', level: 'L0', readiness: 'done' },
  { kind: 'reassign', label: 'Другой станок', what: 'станок или тип рабочего центра операции', mask: 'только допустимые для операции станки и рабочие с допуском', level: 'L2', readiness: 'nsi',
    note: 'у операций демо-справочников один допустимый тип' },
  { kind: 'reroute', label: 'Другой маршрут', what: 'альтернативная техкарта изделия', mask: 'только действующие техкарты этого изделия', level: 'L2', readiness: 'nsi',
    note: 'альтернативных техкарт в демо-справочниках нет' },
  { kind: 'split', label: 'Дробить партию', what: 'число партий запуска и транспортные партии', mask: 'размер партии — в пределах минимума и максимума изделия', level: 'L2', readiness: 'done' },
  { kind: 'merge', label: 'Объединить партии', what: 'число партий — слияние партий одного заказа', mask: 'размер партии — в пределах минимума и максимума изделия', level: 'L2', readiness: 'done' },
  { kind: 'transfer', label: 'Перенести в цех', what: 'цех операции', mask: 'в цехе есть нужный тип рабочего центра; учитывается перевозка между цехами', level: 'L2', readiness: 'planned', note: 'волна 2 (Р5)' },
  { kind: 'outsource', label: 'Отдать на сторону', what: 'операция или полуфабрикат — закупка у поставщика', mask: 'есть поставщик с ценой и сроком в справочниках; доля закупок в себестоимости не выше лимита', level: 'L2', readiness: 'nsi',
    note: 'у изделий демо-справочников нет полуфабрикатов во входах' },
  { kind: 'shift', label: 'Сдвинуть запуск', what: 'срок запуска заказа (± неделя за ход)', mask: 'не раньше сегодняшнего дня и поставок материалов; не позже срока минус цикл', level: 'L2', readiness: 'done' },
  { kind: 'drop', label: 'Отказаться от заказа', what: 'заказ исключается — штраф и упущенная маржа', mask: 'не для обязательных заказов', level: 'L2', readiness: 'planned', note: 'волна 2 (Р5)' },
  { kind: 'finance', label: 'Транш / отсрочка', what: 'график траншей кредитной линии (25, 50 или 100 % лимита) и погашение', mask: 'выборка транша не больше свободного лимита; ковенанты соблюдены', level: 'L2', readiness: 'done' },
]

/** Синонимы бэкенда → канонический вид. */
export function canonicalKind(kind: MoveKind): MoveKind {
  return kind === 'shift_plus' || kind === 'shift_minus' ? 'shift' : kind
}

const BY_KIND: Readonly<Record<string, MoveKindMeta>> = Object.fromEntries(MOVE_KINDS.map((m) => [m.kind, m]))

export function moveKindMeta(kind: MoveKind): MoveKindMeta {
  const c = canonicalKind(kind)
  return BY_KIND[c] ?? { kind: c, label: 'другой ход', what: '', mask: 'неизвестный вид хода', level: 'L2', readiness: 'planned' }
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
