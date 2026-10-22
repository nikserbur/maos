/**
 * Пресеты конструктора эвристик хранятся В ПРОЕКТЕ (UX-V2 §4.2 шаг 5): ключ `heuristic_presets`
 * в KV-настройках проекта (`PUT /api/prefs/:key`, та же таблица, что дашборд «Аналитики»).
 * Нет связи — запасной localStorage с бейджем «локально»; старые локальные пресеты G1
 * переносятся в проект при первой удачной записи.
 */
import { api } from '../../lib/api'
import type { Crit } from './types'

export const PRESETS_KEY = 'heuristic_presets'
const LS_PRESETS = 'maos.heuristics'
export const LS_CURRENT = 'maos.heuristic.current'

export type HeuristicPresets = Readonly<Record<string, readonly Crit[]>>
export type PresetsSource = 'project' | 'local'

function readLocal(): HeuristicPresets {
  try {
    const raw = localStorage.getItem(LS_PRESETS)
    return raw ? (JSON.parse(raw) as HeuristicPresets) : {}
  } catch {
    return {}
  }
}

function writeLocal(p: HeuristicPresets): void {
  try { localStorage.setItem(LS_PRESETS, JSON.stringify(p)) } catch { /* приватный режим */ }
}

const isCrit = (c: unknown): c is Crit =>
  typeof c === 'object' && c !== null && 'criterion' in c && 'weight' in c

/** Загрузить пресеты: проект → при сбое локально. Локальные G1-пресеты, которых нет в проекте, подмешиваются. */
export async function loadPresets(): Promise<{ presets: HeuristicPresets; source: PresetsSource }> {
  const local = readLocal()
  try {
    const value = await api.prefs.get<Record<string, unknown>>(PRESETS_KEY)
    const project: Record<string, readonly Crit[]> = {}
    if (value && typeof value === 'object') {
      for (const [name, crits] of Object.entries(value)) if (Array.isArray(crits) && crits.every(isCrit)) project[name] = crits
    }
    const merged = { ...local, ...project }
    const missing = Object.keys(local).filter((k) => !(k in project))
    if (missing.length) await api.prefs.set(PRESETS_KEY, merged).catch(() => {})
    return { presets: merged, source: 'project' }
  } catch {
    return { presets: local, source: 'local' }
  }
}

export async function savePresets(presets: HeuristicPresets): Promise<PresetsSource> {
  writeLocal(presets)
  try {
    await api.prefs.set(PRESETS_KEY, presets)
    return 'project'
  } catch {
    return 'local'
  }
}

export function readCurrentCrits(fallback: readonly Crit[]): readonly Crit[] {
  try {
    const s = localStorage.getItem(LS_CURRENT)
    if (s) { const v = JSON.parse(s); if (Array.isArray(v) && v.every(isCrit)) return v }
  } catch { /* noop */ }
  return fallback
}

export function writeCurrentCrits(crits: readonly Crit[]): void {
  try { localStorage.setItem(LS_CURRENT, JSON.stringify(crits)) } catch { /* noop */ }
}
