/**
 * Цех типа РЦ для группировки Ганта «по цехам» (X1 §5.1): `group_name` справочника
 * типов оборудования (GET /api/work_center_types). Один запрос на сессию, кэш в модуле;
 * без связи — пустая карта, и Гант остаётся в группировке по типам РЦ.
 */
import { useEffect, useState } from 'react'
import { api } from '../../lib/api'

export type ShopLookup = (wcTypeId: string) => string | undefined

let cache: ReadonlyMap<string, string> | null = null
let inflight: Promise<ReadonlyMap<string, string>> | null = null

async function loadShops(): Promise<ReadonlyMap<string, string>> {
  if (cache) return cache
  if (!inflight) {
    inflight = api.workCenterTypes.list()
      .then((types) => {
        const map = new Map<string, string>()
        for (const t of types) if (t.group_name && t.group_name.trim()) map.set(t.id, t.group_name.trim())
        cache = map
        return map
      })
      .catch(() => new Map<string, string>())
      .finally(() => { inflight = null })
  }
  return inflight
}

/** Карта «тип РЦ → цех» и признак, что цехов в НСИ есть хотя бы два (иначе группировка бессмысленна). */
export function useShops(): { shopOf: ShopLookup; hasShops: boolean } {
  const [map, setMap] = useState<ReadonlyMap<string, string>>(cache ?? new Map())
  useEffect(() => {
    let alive = true
    void loadShops().then((m) => { if (alive) setMap(m) })
    return () => { alive = false }
  }, [])
  const shopOf: ShopLookup = (id) => map.get(id)
  return { shopOf, hasShops: new Set(map.values()).size > 1 }
}
