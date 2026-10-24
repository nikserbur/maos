/**
 * Индекс командной палитры (UX-V2 §7 G4, Cmd/Ctrl+K): экраны рельсы, узлы карты методологии,
 * прогоны плана из кэша этой машины и действия. Чистые функции: сборка индекса и поиск по
 * подстрокам с ранжированием (точное начало → слово → подстрока), без зависимостей от React.
 */

export type CommandGroup = 'screen' | 'node' | 'run' | 'action'

export interface CommandItem {
  id: string
  group: CommandGroup
  title: string
  /** Вторая строка: группа рельсы, блок карты, дата прогона. */
  hint?: string
  /** Дополнительные слова для поиска (латиница, синонимы). */
  keywords?: readonly string[]
  /** Hash-адрес перехода или действие. */
  href?: string
  run?: () => void
}

export const GROUP_LABEL: Readonly<Record<CommandGroup, string>> = {
  screen: 'Экраны', node: 'Узлы карты', run: 'Прогоны плана', action: 'Действия',
}

const norm = (s: string): string => s.toLowerCase().replace(/ё/g, 'е').trim()

/** Оценка совпадения: 3 — начало заголовка, 2 — начало слова заголовка или ключевого слова, 1 — подстрока в тексте/ключах, 0 — нет. */
export function scoreItem(item: CommandItem, q: string): number {
  const query = norm(q)
  if (!query) return 1
  const title = norm(item.title)
  if (title.startsWith(query)) return 3
  if (title.split(/[\s·/:]+/).some((w) => w.startsWith(query))) return 2
  if ((item.keywords ?? []).some((k) => norm(k).startsWith(query))) return 2
  const hay = [title, norm(item.hint ?? ''), ...(item.keywords ?? []).map(norm)].join(' ')
  return hay.includes(query) ? 1 : 0
}

const GROUP_ORDER: readonly CommandGroup[] = ['action', 'screen', 'run', 'node']

/** Поиск: отфильтрованные и упорядоченные (оценка ↓, группа, исходный порядок) элементы, не больше `limit`. */
export function searchCommands(items: readonly CommandItem[], q: string, limit = 12): CommandItem[] {
  const scored = items
    .map((item, i) => ({ item, i, score: scoreItem(item, q) }))
    .filter((x) => x.score > 0)
  scored.sort((a, b) => b.score - a.score || GROUP_ORDER.indexOf(a.item.group) - GROUP_ORDER.indexOf(b.item.group) || a.i - b.i)
  return scored.slice(0, limit).map((x) => x.item)
}

/** Группировка результата для отрисовки с заголовками групп в порядке появления. */
export function groupCommands(items: readonly CommandItem[]): Array<{ group: CommandGroup; items: CommandItem[] }> {
  const out: Array<{ group: CommandGroup; items: CommandItem[] }> = []
  for (const it of items) {
    const g = out.find((x) => x.group === it.group)
    if (g) g.items.push(it)
    else out.push({ group: it.group, items: [it] })
  }
  return out
}

/** Сочетание клавиш палитры: Cmd+K на macOS, Ctrl+K иначе. */
export function isPaletteShortcut(e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey'>): boolean {
  return (e.metaKey || e.ctrlKey) && !e.altKey && (e.key === 'k' || e.key === 'K' || e.key === 'л' || e.key === 'Л')
}

/** Сочетание клавиш панели MENTAT: Cmd/Ctrl+J (в русской раскладке — «о»). */
export function isMentatShortcut(e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey'>): boolean {
  return (e.metaKey || e.ctrlKey) && !e.altKey && (e.key === 'j' || e.key === 'J' || e.key === 'о' || e.key === 'О')
}
