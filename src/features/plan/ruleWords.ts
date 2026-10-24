/**
 * Правило диспетчеризации словами — для таблиц и заголовков (владелец: «сокращения — нечитаемо»):
 * «по ближайшему сроку» вместо «EDD»; аббревиатура остаётся в подсказке (`ruleLabel(id)`).
 */
import { ruleLabel } from '../../explain/labels'

/** Длинная подпись правила без аббревиатуры: «EDD — по ближайшему сроку» → «по ближайшему сроку». */
export function ruleWords(id: string | null | undefined): string {
  const long = ruleLabel(id, 'long')
  const dash = long.indexOf(' — ')
  return dash > 0 ? long.slice(dash + 3) : long
}
