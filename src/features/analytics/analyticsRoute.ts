/**
 * Адрес «Аналитики» (X2 «адрес — это состояние»): `#/analytics/<вкладка>[/<planId>][?wc=<тип РЦ>&period=<окно>]`.
 * Вкладка и план — в якоре (F5 восстанавливает тот же вид, «Назад» работает), тип РЦ инвестпроекта
 * и окно графиков — в параметрах запроса. Без DOM — vitest.
 */
import { anchorParts, joinAnchor } from '../../shell/router'

export type AnalyticsTab = 'kpi' | 'bottleneck' | 'invest' | 'flow'

export const ANALYTICS_TABS: readonly AnalyticsTab[] = ['kpi', 'bottleneck', 'invest', 'flow']

/** Подписи вкладок — те же в табах, крошках и заголовке вкладки браузера. */
export const TAB_LABEL: Readonly<Record<AnalyticsTab, string>> = {
  kpi: 'Показатели',
  bottleneck: 'Узкие места',
  invest: 'Инвестпроекты',
  flow: 'Потоки',
}

export interface AnalyticsRoute {
  tab: AnalyticsTab
  /** Явно выбранное построение; null — последнее. */
  planId: string | null
}

const isTab = (s: string | undefined): s is AnalyticsTab => ANALYTICS_TABS.includes(s as AnalyticsTab)

/** `invest/7f3a…` → { tab: 'invest', planId: '7f3a…' }; мусор → KPI последнего построения. */
export function parseAnalyticsAnchor(anchor: string | null | undefined): AnalyticsRoute {
  const [first, second] = anchorParts(anchor)
  if (!isTab(first)) return { tab: 'kpi', planId: null }
  return { tab: first, planId: second ?? null }
}

/** { invest, '7f3a…' } → `invest/7f3a…`; без плана — только вкладка. */
export function analyticsAnchor(tab: AnalyticsTab, planId?: string | null): string {
  return joinAnchor(tab, planId)
}

/** Подпись для крошек: «Узкие места · План №28». */
export function analyticsCrumb(tab: AnalyticsTab, planTitle: string | null): string {
  return planTitle ? `${TAB_LABEL[tab]} · ${planTitle}` : TAB_LABEL[tab]
}
