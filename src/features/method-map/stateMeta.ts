/**
 * Словарь состояний узлов (UX-V2 §3.4): глиф, подпись, тон токена и приоритет
 * агрегации «состояние блока = худшее из детей». Цвет никогда не единственный
 * сигнал — у каждого состояния свой глиф (● ▲ ■ ○ ◌).
 */
import type { NodeState, Provenance, Stage } from './types'

export interface StateMeta {
  /** Текстовый глиф для подписей и aria. */
  glyph: string
  label: string
  /** CSS-класс глифа (glyphs.css / map.css). */
  glyphClass: string
  /** Что предлагает панель (UX-V2 §3.4, колонка «Что предлагает панель»). */
  hint: string
  /** Приоритет агрегации: меньше — хуже. `planned` не ухудшает блок. */
  priority: number
}

export const STATE_META: Readonly<Record<NodeState, StateMeta>> = {
  error:        { glyph: '■', label: 'ошибка', glyphClass: 'mm-glyph--error', hint: 'Валидация не прошла — откройте экран и исправьте.', priority: 0 },
  unconfigured: { glyph: '◌', label: 'не задано', glyphClass: 'mm-glyph--unconfigured', hint: 'Обязательные данные не заданы — «Задать» ведёт на экран.', priority: 1 },
  stale:        { glyph: '▲', label: 'устарело', glyphClass: 'mm-glyph--stale', hint: 'Вход изменился после последнего расчёта — пересчитайте.', priority: 2 },
  default:      { glyph: '○', label: 'по умолчанию', glyphClass: 'mm-glyph--default', hint: 'Значения по умолчанию кода/НСИ — примите или оцените по данным.', priority: 3 },
  manual:       { glyph: '■', label: 'задано вручную', glyphClass: 'mm-glyph--manual', hint: 'Задано пользователем.', priority: 4 },
  normative:    { glyph: '■', label: 'норматив', glyphClass: 'mm-glyph--normative', hint: 'ГОСТ, норматив или экспертная калибровка — не оценка по данным.', priority: 5 },
  estimated:    { glyph: '●', label: 'оценено', glyphClass: 'mm-glyph--estimated', hint: 'Оценено по данным: есть источник, объём и период.', priority: 5 },
  calibrated:   { glyph: '●', label: 'калибровано', glyphClass: 'mm-glyph--calibrated', hint: 'Подобрано по план-факту — см. отчёт калибровки.', priority: 5 },
  planned:      { glyph: '◌', label: 'в плане', glyphClass: 'mm-glyph--planned', hint: 'Ещё не реализовано — см. волну в «Методике».', priority: 9 },
}

export const STAGE_LABEL: Readonly<Record<Stage, string>> = {
  done: 'реализовано',
  w1: 'волна 1',
  w2: 'волна 2',
  w3: 'волна 3',
}

export const PROVENANCE_LABEL: Readonly<Record<Provenance, string>> = {
  observed: 'наблюдение',
  estimated: 'оценка по данным',
  calibrated: 'калибровка',
  normative: 'норматив',
  manual: 'вручную',
  default: 'по умолчанию',
  ui: 'подобрано для UI',
  synthetic: 'синтетика',
}

/** Состояние узла по происхождению значения его паспорта. */
export function stateFromProvenance(p: Provenance): NodeState {
  switch (p) {
    case 'observed':
    case 'estimated':
      return 'estimated'
    case 'calibrated':
      return 'calibrated'
    case 'normative':
      return 'normative'
    case 'manual':
      return 'manual'
    case 'ui':
    case 'synthetic':
    default:
      return 'default'
  }
}

/** Худшее из состояний детей; `planned` учитывается, только если других нет. */
export function worstState(states: readonly NodeState[]): NodeState {
  let worst: NodeState | null = null
  for (const s of states) {
    if (s === 'planned') continue
    if (worst === null || STATE_META[s].priority < STATE_META[worst].priority) worst = s
  }
  if (worst !== null) return worst
  return states.length > 0 ? 'planned' : 'unconfigured'
}
