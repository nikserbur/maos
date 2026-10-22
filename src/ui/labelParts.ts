/**
 * Подписи в капителях (X1 §7 «Русская копия»): CSS `text-transform: uppercase` превращает
 * греческие буквы в заглавные («α хвоста» → «Α ХВОСТА», где Α неотличима от «А»).
 * Разбиваем подпись на обычные и греческие фрагменты — греческие рендерятся без трансформации.
 * Чистая функция — проверяется тестом.
 */
export interface LabelPart {
  text: string
  /** Фрагмент из греческих букв (α, β, σ, ρ, ν…) — не переводить в верхний регистр. */
  greek: boolean
}

const GREEK = /[Ͱ-Ͽ]+/g

export function splitGreek(label: string): LabelPart[] {
  const parts: LabelPart[] = []
  let last = 0
  for (const m of label.matchAll(GREEK)) {
    const at = m.index ?? 0
    if (at > last) parts.push({ text: label.slice(last, at), greek: false })
    parts.push({ text: m[0], greek: true })
    last = at + m[0].length
  }
  if (last < label.length) parts.push({ text: label.slice(last), greek: false })
  return parts
}

/** Есть ли в подписи греческие буквы (нужна ли защита от капителей). */
export function hasGreek(label: string): boolean {
  return /[Ͱ-Ͽ]/.test(label)
}
