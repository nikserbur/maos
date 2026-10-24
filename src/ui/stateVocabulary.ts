/**
 * Единый словарь состояний и происхождения (X2: «одно состояние — один глиф — одно слово»).
 * Две семьи, внутри каждой глиф однозначен:
 *  - происхождение значения: ● по данным (оценка, наблюдение, калибровка — подробность в title) ·
 *    ◆ норматив · ■ вручную · ○ по умолчанию (поглощает «для UI» и «константа кода») · ▲ устарело / синтетика;
 *  - вычисление: ✕ ошибка · ◌ не задано.
 * «В плане» (ещё не реализовано) — не глиф, а пунктирная рамка с текстом.
 * Карта, паспорт, легенды, степпер и полоса методологии берут глиф и слово только отсюда.
 * Чистые данные — проверяются тестом.
 */
import type { NodeState } from '../features/method-map/types'

export type VocabKey = 'data' | 'normative' | 'manual' | 'default' | 'stale' | 'error' | 'unset' | 'planned'
export type VocabFamily = 'provenance' | 'computation' | 'roadmap'

export interface VocabEntry {
  key: VocabKey
  family: VocabFamily
  /** Текстовый глиф (aria, подписи); у «в плане» глифа нет. */
  glyph: '●' | '◆' | '■' | '○' | '▲' | '✕' | '◌' | ''
  /** Короткое слово бейджа и легенды. */
  word: string
  /** Полная подпись (подсказка, панель). */
  label: string
  /** Что делать — для подсказки легенды. */
  hint: string
  /** Тон: нормальное состояние нейтрально, цвет — только у отклонений (и только на глифе). */
  tone: 'neutral' | 'muted' | 'warn' | 'bad' | 'manual'
}

export const VOCABULARY: Readonly<Record<VocabKey, VocabEntry>> = {
  data:      { key: 'data', family: 'provenance', glyph: '●', word: 'по данным', label: 'оценено по данным', hint: 'Есть источник, объём и период; наблюдение и калибровка по план-факту — тоже здесь (подробность в подсказке).', tone: 'neutral' },
  normative: { key: 'normative', family: 'provenance', glyph: '◆', word: 'норматив', label: 'норматив или экспертная калибровка', hint: 'ГОСТ, норматив или экспертная калибровка — не оценка по данным.', tone: 'neutral' },
  manual:    { key: 'manual', family: 'provenance', glyph: '■', word: 'вручную', label: 'задано вручную', hint: 'Значение задал пользователь.', tone: 'manual' },
  default:   { key: 'default', family: 'provenance', glyph: '○', word: 'по умолчанию', label: 'значение по умолчанию', hint: 'Значение кода, НСИ или подобранное для интерфейса — примите или оцените по данным.', tone: 'muted' },
  stale:     { key: 'stale', family: 'provenance', glyph: '▲', word: 'устарело', label: 'устарело или синтетика', hint: 'Вход изменился после расчёта (пересчитайте) или данные синтетические (демонстрация, не факт).', tone: 'warn' },
  error:     { key: 'error', family: 'computation', glyph: '✕', word: 'ошибка', label: 'ошибка расчёта или проверки', hint: 'Расчёт или проверка не прошли — откройте экран блока и исправьте.', tone: 'bad' },
  unset:     { key: 'unset', family: 'computation', glyph: '◌', word: 'не задано', label: 'обязательные данные не заданы', hint: 'Обязательные данные не заданы — «Задать» ведёт на экран.', tone: 'muted' },
  planned:   { key: 'planned', family: 'roadmap', glyph: '', word: 'в плане', label: 'ещё не реализовано', hint: 'Появится в одной из следующих волн — см. «Методику».', tone: 'muted' },
}

/** Состояние узла карты → запись словаря. */
export const NODE_STATE_VOCAB: Readonly<Record<NodeState, VocabKey>> = {
  estimated: 'data',
  calibrated: 'data',
  normative: 'normative',
  manual: 'manual',
  default: 'default',
  stale: 'stale',
  error: 'error',
  unconfigured: 'unset',
  planned: 'planned',
}

export function vocabForState(state: NodeState): VocabEntry {
  return VOCABULARY[NODE_STATE_VOCAB[state]]
}

/** Подробность для подсказки, если одно слово объединяет несколько исходов (● — наблюдение/оценка/калибровка). */
export const STATE_DETAIL: Readonly<Partial<Record<NodeState, string>>> = {
  estimated: 'оценено по данным',
  calibrated: 'калибровка по план-факту',
}
