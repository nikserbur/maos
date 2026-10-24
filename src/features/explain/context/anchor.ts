/** Узел карты для ссылки: сам узел или ближайший предок по id (факт `ag.rl.move.1` → `ag.rl`). */
import { getNode } from '../../method-map/registry'

export function mapAnchor(id: string): string | null {
  const parts = id.split('.')
  for (let n = parts.length; n > 0; n--) {
    const cand = parts.slice(0, n).join('.')
    if (getNode(cand)) return cand
  }
  return null
}
