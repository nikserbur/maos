/**
 * Паспорт генератора (GET /macro/regimes) для «Мониторинга»: история рядов ЦБ для вееров «Внешних
 * условий» (если бэкенд её отдаёт) и последний месяц данных. Один запрос на сессию; ошибка — null
 * (карточки останутся без истории, экран не падает).
 */
import { useEffect, useState } from 'react'
import { api, type MacroRegimes } from '../../lib/api'

let loaded: MacroRegimes | null = null
let pending: Promise<MacroRegimes | null> | null = null

function load(): Promise<MacroRegimes | null> {
  if (loaded) return Promise.resolve(loaded)
  if (!pending) {
    pending = api.macro.regimes()
      .then((r) => { loaded = r; return r })
      .catch(() => null)
      .finally(() => { pending = null })
  }
  return pending
}

export function useMacroRegimes(): MacroRegimes | null {
  const [state, setState] = useState<MacroRegimes | null>(loaded)
  useEffect(() => {
    let alive = true
    if (!loaded) void load().then((r) => { if (alive) setState(r) })
    return () => { alive = false }
  }, [])
  return state
}
