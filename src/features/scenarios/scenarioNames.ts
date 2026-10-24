/** Имена сценариев: свободные, но без повторов («Базовый» → «Базовый 2»; регистр и пробелы не различаются). */

/** «Базовый» → «Базовый 2», если имя занято. */
export function uniqueName(name: string, existing: readonly string[]): string {
  const taken = new Set(existing.map((n) => n.trim().toLowerCase()))
  const base = name.trim() || 'Новый сценарий'
  if (!taken.has(base.toLowerCase())) return base
  for (let i = 2; i < 1000; i++) {
    const next = `${base} ${i}`
    if (!taken.has(next.toLowerCase())) return next
  }
  return `${base} ${existing.length + 1}`
}

/** Имя уже занято другим сценарием. */
export function isDuplicateName(name: string, existing: readonly string[]): boolean {
  const n = name.trim().toLowerCase()
  return n !== '' && existing.some((e) => e.trim().toLowerCase() === n)
}
