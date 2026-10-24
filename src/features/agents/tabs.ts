/**
 * Вкладки экрана «Агенты» в адресе `#/agents/<вкладка>` (X2 «адрес — это состояние»): F5 и «Назад»
 * возвращают ту же вкладку; неизвестный якорь — «Вердикт».
 */
import type { TabItem } from '../../ui/kit'
import { buildHash } from '../../shell/router'

export type AgentsTab = 'verdict' | 'evidence' | 'guardrails' | 'how'

/** Вкладки — ссылки (`#/agents/<id>`): Cmd/Ctrl-клик открывает раздел в новой вкладке браузера. */
export const AGENTS_TABS: ReadonlyArray<TabItem<AgentsTab>> = [
  { id: 'verdict', label: 'Вердикт', href: buildHash('agents', 'verdict') },
  { id: 'evidence', label: 'Доказательства', href: buildHash('agents', 'evidence') },
  { id: 'guardrails', label: 'Полномочия', href: buildHash('agents', 'guardrails') },
  { id: 'how', label: 'Как устроен', href: buildHash('agents', 'how') },
]

export function agentsTab(anchor: string | null | undefined): AgentsTab {
  const head = (anchor ?? '').split('/')[0]
  return AGENTS_TABS.some((t) => t.id === head) ? (head as AgentsTab) : 'verdict'
}
