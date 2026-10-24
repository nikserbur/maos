/**
 * Версия техкарты при сохранении (P-42): сервер делает каждую сохранённую техкарту изделия
 * действующей с версией max+1, прежние — недействующими. Подтверждение называет это прямо:
 * «Сохранить как версию v3 — станет действующей для ГП-0001 (сейчас действует v2)». Чистые функции.
 */
import type { Product, Routing } from '../../../lib/api'
import { countText } from '../../../explain/format'
import { isDefaultRouting } from '../registries'

export interface VersionPlanInput {
  productId: string
  products: ReadonlyArray<Product>
  routings: ReadonlyArray<Routing>
  /** Открытая техкарта (null — новая). */
  editing: Routing | null
  /** Операций, у которых сервер не сохранит наладку из конструктора. */
  setupLoss: number
}

export interface VersionPlan {
  next: number
  current: number | null
  title: string
  consequence: string
  /** Дополнительные предупреждения (наладка, изделие без действующей техкарты). */
  notes: string[]
  confirmLabel: string
}

const versionOf = (r: Routing): number => {
  const v = Number(r.version)
  return Number.isFinite(v) && v > 0 ? v : 1
}

const productLabel = (p: Product | undefined, id: string): string => (p ? `${p.code} ${p.name}`.trim() : id)

export function versionPlan({ productId, products, routings, editing, setupLoss }: VersionPlanInput): VersionPlan {
  const notes: string[] = []
  if (setupLoss > 0) {
    notes.push(`Наладку из конструктора сервер пока не сохраняет: у ${countText(setupLoss, ['операции', 'операций', 'операций'])} она станет 0 — её можно восстановить загрузкой НСИ.`)
  }
  if (!productId) {
    return {
      next: 1, current: null, title: 'Сохранить техкарту без изделия?', notes, confirmLabel: 'Сохранить',
      consequence: 'Техкарта не привязана к изделию — план её не использует, пока изделие не выбрано.',
    }
  }
  const same = routings.filter((r) => r.product_id === productId)
  const next = same.reduce((m, r) => Math.max(m, versionOf(r)), 0) + 1
  const active = same.find((r) => isDefaultRouting(r)) ?? null
  const current = active ? versionOf(active) : null
  const product = productLabel(products.find((p) => p.id === productId), productId)
  const movedFrom = editing && editing.product_id && editing.product_id !== productId ? editing.product_id : ''
  if (movedFrom && isDefaultRouting(editing ?? {})) {
    notes.push(`У изделия ${productLabel(products.find((p) => p.id === movedFrom), movedFrom)} не останется действующей техкарты — план не сможет его выпускать.`)
  }
  const editingAlternative = Boolean(editing && !movedFrom && !isDefaultRouting(editing))
  if (editingAlternative) {
    return {
      next, current, title: 'Сделать альтернативу действующей?', notes, confirmLabel: 'Сделать действующей',
      consequence: `Сохранить как версию v${next} — станет действующей для ${product}${current ? ` вместо v${current}` : ''}; прежняя действующая станет альтернативой. ` +
        'Сохранять как альтернативу сервер пока не умеет.',
    }
  }
  const tail = current ? ` (сейчас действует v${current})` : ''
  const replace = editing && !movedFrom ? ' Открытая версия заменяется новой.' : ''
  return {
    next, current, title: 'Сохранить новую версию техкарты?', notes, confirmLabel: `Сохранить как v${next}`,
    consequence: `Сохранить как версию v${next} — станет действующей для ${product}${tail}.${replace}`,
  }
}

/* ── Куда «переехала» техкарта после сохранения (для 404 по старому адресу) ─────────── */

const MOVED_KEY = 'maos.routing-moved'

export function rememberMove(oldId: string, newId: string, productId: string): void {
  try {
    const raw = sessionStorage.getItem(MOVED_KEY)
    const map = raw ? (JSON.parse(raw) as Record<string, { newId: string; productId: string }>) : {}
    sessionStorage.setItem(MOVED_KEY, JSON.stringify({ ...map, [oldId]: { newId, productId } }))
  } catch { /* приватный режим: подсказка «открыть действующую» просто не появится */ }
}

export function movedProduct(oldId: string): string | null {
  try {
    const raw = sessionStorage.getItem(MOVED_KEY)
    const map = raw ? (JSON.parse(raw) as Record<string, { newId: string; productId: string }>) : {}
    return map[oldId]?.productId ?? null
  } catch { return null }
}
