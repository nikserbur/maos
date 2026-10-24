/**
 * Месяцы истории словами (владелец: «сырые 2022-02 до пользователя не доходят»): «сент. 2026»,
 * окно «февр.–авг. 2022» / «дек. 2014 – июнь 2015», сдвиг месяца. Чистые функции — vitest.
 */
const MONTHS_RU = ['янв.', 'февр.', 'март', 'апр.', 'май', 'июнь', 'июль', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.'] as const

function parse(ym: string | undefined): { y: number; m: number } | null {
  const r = /^(\d{4})-(\d{2})/.exec(ym ?? '')
  if (!r) return null
  const m = Number(r[2]) - 1
  return m >= 0 && m < 12 ? { y: Number(r[1]), m } : null
}

/** «2026-09» → «сент. 2026»; мусор → ''. */
export function monthShort(ym: string | undefined): string {
  const p = parse(ym)
  return p ? `${MONTHS_RU[p.m]} ${p.y}` : ''
}

/** «2022-02» + 6 → «2022-08». */
export function addMonths(ym: string, k: number): string {
  const p = parse(ym)
  if (!p) return ''
  const t = p.y * 12 + p.m + Math.round(k)
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`
}

/** Число месяцев от a до b (b − a). */
export function monthsBetween(a: string, b: string): number {
  const pa = parse(a), pb = parse(b)
  return pa && pb ? (pb.y - pa.y) * 12 + (pb.m - pa.m) : Number.NaN
}

/** Окно истории словами: «февр.–авг. 2022», «дек. 2014 – июнь 2015», «март 2023». */
export function windowLabel(from: string, months: number): string {
  const a = parse(from)
  if (!a) return ''
  const to = parse(addMonths(from, Math.max(1, months) - 1))
  if (!to || months <= 1) return monthShort(from)
  if (a.y === to.y) return `${MONTHS_RU[a.m]}–${MONTHS_RU[to.m]} ${a.y}`
  return `${monthShort(from)} – ${MONTHS_RU[to.m]} ${to.y}`
}

/** Подряд идущие месяцы → окна: ['2014-12','2015-01','2022-02'] → «дек. 2014 – янв. 2015, февр. 2022». */
export function monthRuns(months: readonly string[]): string {
  const sorted = [...months].sort()
  const runs: Array<{ from: string; n: number }> = []
  for (const m of sorted) {
    const last = runs[runs.length - 1]
    if (last && addMonths(last.from, last.n) === m) runs[runs.length - 1] = { ...last, n: last.n + 1 }
    else runs.push({ from: m, n: 1 })
  }
  return runs.map((r) => windowLabel(r.from, r.n)).join(', ')
}
