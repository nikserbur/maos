/**
 * Словарь состояний узлов карты (UX-V2 §3.4) — производный от единого словаря src/ui/stateVocabulary.ts
 * (X2 P-124: «одно состояние — один глиф — одно слово»): глиф и слово — оттуда, здесь только класс глифа,
 * подсказка панели и приоритет агрегации «состояние блока = худшее из детей». ✕ — ошибка, ◌ — только
 * «не задано», «в плане» — пунктирная карточка без глифа. Цвет никогда не единственный сигнал.
 */
import { STAGE_META as STAGES } from '../../explain/stages'
import { vocabForState } from '../../ui/stateVocabulary'
import type { NodeState, Provenance, Stage } from './types'

export interface StateMeta {
  /** Текстовый глиф для подписей и aria (у «в плане» — пусто). */
  glyph: string
  /** Слово единого словаря — то же в легенде, бейдже и чипе. */
  label: string
  /** CSS-класс глифа (styles/glyphs.css). */
  glyphClass: string
  /** Что предлагает панель (UX-V2 §3.4, колонка «Что предлагает панель»). */
  hint: string
  /** Приоритет агрегации: меньше — хуже. `planned` не ухудшает блок. */
  priority: number
}

const HINT: Readonly<Record<NodeState, string>> = {
  error: 'Расчёт не выполнен — причина ниже.',
  unconfigured: 'Обязательные данные не заданы — «Открыть» ведёт на экран, где их задают.',
  stale: 'Вход изменился после расчёта или расчёт не завершён — пересчитайте.',
  default: 'Значения по умолчанию кода или НСИ — примите или оцените по данным.',
  manual: 'Задано пользователем.',
  normative: 'ГОСТ, норматив или экспертная калибровка — не оценка по данным.',
  estimated: 'Оценено по данным: есть источник, объём и период.',
  calibrated: 'Подобрано по план-факту — см. отчёт калибровки.',
  planned: 'Ещё не реализовано — см. волну в «Методике».',
}

const PRIORITY: Readonly<Record<NodeState, number>> = {
  error: 0, unconfigured: 1, stale: 2, default: 3, manual: 4, normative: 5, estimated: 5, calibrated: 5, planned: 9,
}

/** «В плане» — без глифа (пустой слот той же ширины), чтобы ◌ значил только «не задано». */
const GLYPH_CLASS = (s: NodeState): string => (s === 'planned' ? 'mm-glyph--blank' : `mm-glyph--${s}`)

export const STATE_META: Readonly<Record<NodeState, StateMeta>> = Object.fromEntries(
  (Object.keys(PRIORITY) as NodeState[]).map((s) => {
    const v = vocabForState(s)
    return [s, { glyph: v.glyph, label: v.word, glyphClass: GLYPH_CLASS(s), hint: HINT[s], priority: PRIORITY[s] }]
  }),
) as Record<NodeState, StateMeta>

/** Подпись стадии — из единого реестра стадий (тот же STAGE_META, что у чипов «Методики»). */
export const STAGE_LABEL: Readonly<Record<Stage, string>> = {
  done: STAGES.done.label,
  w1: STAGES.w1.label,
  w2: STAGES.w2.label,
  w3: STAGES.w3.label,
}

/** Состояние узла по происхождению значения его паспорта; синтетика — ▲ (данные не факт). */
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
    case 'synthetic':
      return 'stale'
    case 'ui':
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
