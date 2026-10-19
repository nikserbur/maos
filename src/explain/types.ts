/**
 * Типы реестра объяснений «i» (как считается каждое число на экране).
 * Контракт: docs/AUDIT-2026-10.md §4.2–§4.4.
 */
import type { DiagramId } from '../diagrams'
import type { Unit } from './format'

/** Разделы экрана «Методика», кроме разделов-схем (их якоря = DiagramId). */
export const METHODOLOGY_SECTIONS = [
  'overview',
  'kpi-definitions',
  'terminology',
  'validation',
  'competitors',
  'rl',
] as const

export type MethodologySection = (typeof METHODOLOGY_SECTIONS)[number]

/** Якорь «Методики»: `#/methodology/<anchor>`. */
export type MethodologyAnchor = DiagramId | MethodologySection

export interface MetricVariable {
  /** Ключ плейсхолдера `{key}` в формуле и ключ в `values` у InfoTip. */
  key: string
  /** Смысл переменной (рус.). */
  label: string
  /** Единица; нет — строковое значение (имя РЦ, правило) или безразмерное. */
  unit?: Unit
}

export interface MetricExplain {
  /** Пространство имён: plan.*, opt.*, forecast.*, invest.*, analytics.*, sim.* */
  id: string
  title: string
  /** Смысл показателя одной-двумя фразами. */
  short: string
  /** Формула в Unicode-нотации с `{key}`; строки разделяются `\n`. Фигурные скобки — только плейсхолдеры. */
  formula: string
  variables: readonly MetricVariable[]
  /** Единица основного значения. */
  unit: Unit
  /** Метод расчёта: откуда берутся величины, допущения модели. */
  method: string
  /** Ограничения, о которых должен знать читатель (показываются приглушённо). */
  caveats?: readonly string[]
  diagram?: DiagramId
  learnMore?: MethodologyAnchor
}
