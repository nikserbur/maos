/**
 * Индекс командной палитры (UX-V2 §7 G4, Cmd/Ctrl+K): экраны рельсы, узлы карты методологии,
 * прогоны плана из кэша этой машины и действия. Чистые функции: сборка индекса и поиск по
 * подстрокам с ранжированием (точное начало → слово → подстрока), без зависимостей от React.
 */

export type CommandGroup = 'recent' | 'screen' | 'scenario' | 'registry' | 'node' | 'run' | 'action'

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
  /** Сочетание клавиш: 'mod+j' → «⌘J» на macOS, «Ctrl+J» иначе. */
  shortcut?: string
}

export const GROUP_LABEL: Readonly<Record<CommandGroup, string>> = {
  recent: 'Недавние', screen: 'Экраны', scenario: 'Сценарии', registry: 'Справочники', node: 'Узлы карты', run: 'Прогоны плана', action: 'Действия',
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

const GROUP_ORDER: readonly CommandGroup[] = ['recent', 'action', 'screen', 'scenario', 'registry', 'run', 'node']

/** Лимиты по группам: на пустом запросе видны все экраны (12) — ни одна группа не вытесняет другие. */
export const GROUP_LIMIT: Readonly<Record<CommandGroup, number>> = { recent: 5, action: 6, screen: 16, scenario: 6, registry: 8, run: 6, node: 8 }

/** Поиск: отфильтрованные и упорядоченные (оценка ↓, группа, исходный порядок) элементы, не больше `limit`. */
export function searchCommands(items: readonly CommandItem[], q: string, limit = 12): CommandItem[] {
  const scored = items
    .map((item, i) => ({ item, i, score: scoreItem(item, q) }))
    .filter((x) => x.score > 0)
  scored.sort((a, b) => b.score - a.score || GROUP_ORDER.indexOf(a.item.group) - GROUP_ORDER.indexOf(b.item.group) || a.i - b.i)
  return scored.slice(0, limit).map((x) => x.item)
}

/**
 * Поиск с лимитом на группу (палитра): результаты в порядке групп, внутри — по оценке и исходному
 * порядку. На пустом запросе «Недавние» идут первыми, узлы карты не показываются (их сотни).
 */
export function searchCommandsGrouped(items: readonly CommandItem[], q: string, limits: Readonly<Record<CommandGroup, number>> = GROUP_LIMIT): CommandItem[] {
  const empty = !norm(q)
  const scored = items
    .map((item, i) => ({ item, i, score: scoreItem(item, q) }))
    .filter((x) => x.score > 0 && !(empty && x.item.group === 'node'))
  scored.sort((a, b) => GROUP_ORDER.indexOf(a.item.group) - GROUP_ORDER.indexOf(b.item.group) || b.score - a.score || a.i - b.i)
  const used = new Map<CommandGroup, number>()
  const out: CommandItem[] = []
  for (const x of scored) {
    const n = used.get(x.item.group) ?? 0
    if (n >= limits[x.item.group]) continue
    used.set(x.item.group, n + 1)
    out.push(x.item)
  }
  return out
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

/** macOS / iOS — по платформе браузера (общая проверка верхней панели и палитры). */
export function isMacPlatform(nav: { platform?: string; userAgent?: string } | undefined = typeof navigator !== 'undefined' ? navigator : undefined): boolean {
  if (!nav) return false
  return /Mac|iPhone|iPad/i.test(nav.platform || nav.userAgent || '')
}

/** 'mod+k' → «⌘K» (macOS) / «Ctrl K» (иначе); 'mod+j' → «⌘J» / «Ctrl J». */
export function shortcutText(spec: string, mac: boolean = isMacPlatform()): string {
  const parts = spec.split('+').map((p) => p.trim().toLowerCase())
  const key = (parts.pop() ?? '').toUpperCase()
  const mods = parts.map((m) => (m === 'mod' ? (mac ? '⌘' : 'Ctrl') : m === 'shift' ? (mac ? '⇧' : 'Shift') : m === 'alt' ? (mac ? '⌥' : 'Alt') : m))
  return mac ? `${mods.join('')}${key}` : [...mods, key].join(' ')
}
