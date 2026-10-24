/**
 * Переходы экрана «План» (X2 «один адрес — одна вещь»): результат — `#/plan/run/<key>[/<раздел>]`,
 * мастер — `#/plan/new/<шаг>`, история — `#/plan`. «Новый план» всегда открывает шаг «Программа»
 * с параметрами последнего прогона; «Повторить» — шаг «Запуск» с параметрами выбранного прогона
 * (запуск — только по нажатию человека). Без сохранённых параметров — мастер с текущими значениями.
 */
import { joinAnchor, navigateTo, parseHash, replaceRoute } from '../../shell/router'
import { browserStorage, readRunMeta, runMetaMap } from './runMeta'
import { wizardActions } from './wizard/wizardStore'

/** Разделы результата: slug адреса ↔ id секции ↔ подпись оглавления (sentence case). */
export const RESULT_SECTIONS = [
  { slug: 'kpi', id: 'res-kpi', label: 'KPI' },
  { slug: 'bottleneck', id: 'res-bn', label: 'Узкое место' },
  { slug: 'moves', id: 'res-moves', label: 'Ходы агента' },
  { slug: 'gantt', id: 'res-gantt', label: 'Гант' },
  { slug: 'load', id: 'res-load', label: 'Очереди и загрузка' },
  { slug: 'tables', id: 'res-tables', label: 'Таблицы' },
  { slug: 'cash', id: 'res-cash', label: 'Касса' },
] as const

export type SectionSlug = (typeof RESULT_SECTIONS)[number]['slug']

export const sectionById = (id: string) => RESULT_SECTIONS.find((s) => s.id === id)
export const sectionBySlug = (slug: string | null | undefined) => RESULT_SECTIONS.find((s) => s.slug === slug)

export function runHref(key: string, slug?: string | null): string {
  return `#/plan/${joinAnchor('run', encodeURIComponent(key), slug && slug !== 'kpi' ? slug : null)}`
}

export function openRun(key: string): void {
  navigateTo('plan', joinAnchor('run', key))
}

/** Раздел — в адрес без записи истории (F5 вернёт тот же раздел); выборка `?wc=…` сохраняется. */
export function writeSection(key: string, slug: string): void {
  const params = typeof window !== 'undefined' ? parseHash(window.location.hash).params : {}
  replaceRoute('plan', joinAnchor('run', key, slug === 'kpi' ? null : slug), params)
}

/** «Новый план»: шаг «Программа», параметры последнего прогона (или указанного). */
export function startNewPlan(fromKey?: string | null): void {
  const st = browserStorage()
  const meta = fromKey ? runMetaMap(st).get(fromKey) ?? readRunMeta(st)[0] : readRunMeta(st)[0]
  if (meta) wizardActions.prefill(meta.params, 'program')
  else wizardActions.setStep('program')
  navigateTo('plan', 'new/program')
}

/** «Повторить»: те же параметры на шаге «Запуск» (сводка «что уйдёт в расчёт» и кнопка «Запустить»). */
export function repeatRun(key: string): void {
  const meta = runMetaMap(browserStorage()).get(key)
  if (meta) {
    wizardActions.prefill(meta.params, 'launch')
    navigateTo('plan', 'new/launch')
    return
  }
  wizardActions.setStep('program')
  navigateTo('plan', 'new/program')
}

/** Есть ли сохранённые параметры прогона (иначе «Повторить» откроет мастер с текущими значениями). */
export const canRepeatExactly = (key: string): boolean => runMetaMap(browserStorage()).has(key)
