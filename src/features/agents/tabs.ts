/**
 * Вкладки экрана «Агенты» в адресе `#/agents/<вкладка>` (X2 «адрес — это состояние»): F5 и «Назад»
 * возвращают ту же вкладку; неизвестный якорь — «Вердикт».
 */
import type { PillTab } from '../../ui/kit'

export type AgentsTab = 'verdict' | 'evidence' | 'guardrails' | 'how'

export const AGENTS_TABS: ReadonlyArray<PillTab<AgentsTab>> = [
  { id: 'verdict', label: 'Вердикт' },
  { id: 'evidence', label: 'Доказательства' },
  { id: 'guardrails', label: 'Полномочия' },
  { id: 'how', label: 'Как устроен' },
]

export function agentsTab(anchor: string | null | undefined): AgentsTab {
  const head = (anchor ?? '').split('/')[0]
  return AGENTS_TABS.some((t) => t.id === head) ? (head as AgentsTab) : 'verdict'
}
