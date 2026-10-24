/**
 * Разбор чисел в русском тексте ответа с учётом формата интерфейса (src/explain/format.ts):
 * группы разрядов через пробел/неразрывный пробел, десятичная запятая (или точка), минус «−»/«-»/«–»,
 * порядки «тыс./млн/млрд», единицы «₽», «%», «п. п.», «ч», «мес», «нед», «дн», «шт». Для каждого числа —
 * значение, род единицы и число знаков после запятой: от него зависит допуск сверки (половина последнего
 * разряда), т. е. «−53,3 млн ₽» совпадает с −53 312 000, а «−53,4 млн ₽» — нет.
 */

export type NumUnit = 'money' | 'percent' | 'hours' | 'plain'

export interface ParsedNumber {
  /** Фрагмент как в тексте. */
  raw: string
  /** Значение в базовых единицах: рубли (с учётом порядка), проценты как написано (10 % → 10), часы, число. */
  value: number
  unit: NumUnit
  /** Подпись прочей единицы («мес», «нед», «шт»…), если есть. */
  unitText?: string
  /** Знаков после запятой — допуск сверки 0,5·10^(−decimals)·scale. */
  decimals: number
  /** Множитель порядка (тыс. → 1e3, млн → 1e6, млрд → 1e9). */
  scale: number
  /** Явный знак в тексте. */
  sign: '+' | '-' | null
  start: number
  end: number
}

const SCALE: Readonly<Record<string, number>> = { 'тыс': 1e3, 'млн': 1e6, 'млрд': 1e9 }

/*
 * Знак · целая часть (с группами по 3) · дробная часть · порядок · единица. Перед числом — не буква/цифра,
 * после — не буква/цифра (иначе это часть обозначения: «16К20», «x2»).
 */
const NUM = new RegExp(
  String.raw`(?<![\p{L}\p{N}_.,])([+\-−–]?)(\d{1,3}(?:[   ]\d{3})+|\d+)(?:[.,](\d+))?` +
  String.raw`(?:[   ]?(тыс|млн|млрд)\.?)?` +
  String.raw`(?:[   ]?(₽|руб\.?|%|п\.[   ]?п\.|час(?:а|ов)?|ч|мес|нед|дн|шт|сут))?` +
  String.raw`(?![\p{L}\p{N}])`,
  'gu',
)

function unitOf(u: string | undefined, scaled: boolean): { unit: NumUnit; unitText?: string } {
  if (!u) return { unit: scaled ? 'money' : 'plain' }
  if (u === '₽' || u.startsWith('руб')) return { unit: 'money' }
  if (u === '%' || u.startsWith('п.')) return { unit: 'percent', unitText: u === '%' ? undefined : 'п. п.' }
  if (u === 'ч' || u.startsWith('час')) return { unit: 'hours' }
  return { unit: 'plain', unitText: u }
}

/** Все числа текста по порядку. */
export function parseNumbers(text: string): ParsedNumber[] {
  const out: ParsedNumber[] = []
  for (const m of text.matchAll(NUM)) {
    const [raw, signRaw, intRaw, frac, scaleRaw, unitRaw] = m
    const intDigits = intRaw.replace(/[   ]/g, '')
    const abs = Number(`${intDigits}${frac ? `.${frac}` : ''}`)
    if (!Number.isFinite(abs)) continue
    const sign = signRaw === '+' ? '+' : signRaw ? '-' : null
    const scale = scaleRaw ? SCALE[scaleRaw] : 1
    const { unit, unitText } = unitOf(unitRaw, Boolean(scaleRaw))
    const start = m.index ?? 0
    out.push({
      raw: raw.trim(), value: (sign === '-' ? -abs : abs) * scale, unit, ...(unitText ? { unitText } : {}),
      decimals: frac ? frac.length : 0, scale, sign, start, end: start + raw.length,
    })
  }
  return out
}

/** Допуск сверки: половина единицы последнего показанного разряда (плюс машинный эпсилон). */
export function toleranceOf(n: Pick<ParsedNumber, 'decimals' | 'scale'>): number {
  return 0.5 * 10 ** -n.decimals * n.scale * (1 + 1e-9) + 1e-12
}
