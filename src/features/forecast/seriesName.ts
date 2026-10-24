/**
 * Имя ряда прогноза в две строки (владелец: «Пруток нержавеющий (12Х18Н10Т) — валы и метизы…» обрезалось
 * многоточием): основное название — строка 1, марка и назначение — приглушённая строка 2.
 * «Пруток нержавеющий (12Х18Н10Т) — валы и метизы» → { main: «Пруток нержавеющий», detail: «12Х18Н10Т — валы и метизы» }.
 */
export interface SeriesName { main: string; detail: string }

export function splitSeriesName(name: string): SeriesName {
  const text = name.trim()
  const paren = text.indexOf(' (')
  if (paren > 0) {
    const close = text.indexOf(')', paren)
    const inner = close > paren ? text.slice(paren + 2, close).trim() : text.slice(paren + 2).trim()
    const tail = close > paren ? text.slice(close + 1).trim() : ''
    return { main: text.slice(0, paren).trim(), detail: [inner, tail].filter(Boolean).join(' ') }
  }
  const dash = text.indexOf(' — ')
  if (dash > 0) return { main: text.slice(0, dash).trim(), detail: text.slice(dash + 3).trim() }
  return { main: text, detail: '' }
}
