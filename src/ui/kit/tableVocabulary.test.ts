/**
 * Словарь заголовков таблиц (владелец: «сокращения везде по таблицам — непонятно, неудобно,
 * нечитаемо»). Заголовок — полная русская фраза; у числовой колонки — «…, единица»; аббревиатуры и
 * формулы (CVaR, E[…], Cmax, OTD, CAPEX, ДИ, РЦ, MTBF, голые P10/P90) — в «i» или второй строке.
 * Сканируются заголовки DataColumn (`{ key, title }`), сырые <th>текст</th> и строки `columns: [...]`
 * таблиц-двойников графиков в src/features и src/ui.
 *
 * ALLOW — файлы, где нарушения уже есть (сокращается волнами; цель — пусто). Новый файл с
 * нарушением — ошибка теста; исправленный файл в ALLOW — предупреждение «удалите из списка».
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = fileURLToPath(new URL('../../', import.meta.url))
const ROOT = join(SRC, '..')

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}

/** Запрещённое в заголовке: сокращения и аббревиатуры; P10/P90 — только в скобках после слов. */
export const HEADER_DENY = /Кол-во|Таб\. №|длит\.|(?<!\p{L})Ед\.|польз\.|(?<!\p{L})опер\.|станк\.|(?<!\p{L})изм\.|норм\.|(?<!\p{L})оп\.|(?<!\p{L})РЦ(?!\p{L})|(?<!\p{L})ДИ(?!\p{L})|б\. п\.|CAPEX|E\[|Cmax|CVaR|OTD|MTBF|(?<![(\p{L}\d])P\d0(?![\d)])|^[ΔΣσβp]$/u

/** Заголовки таблиц в исходнике: DataColumn, сырые <th>, колонки таблиц-двойников. */
export function headerTexts(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/\{\s*key:\s*['"][^'"]*['"],\s*title:\s*(['"`])((?:(?!\1).)*)\1/g)) out.push(m[2])
  for (const m of text.matchAll(/<th\b[^>]*>([^<{]+)<\/th>/g)) out.push(m[1].trim())
  for (const m of text.matchAll(/columns:\s*\[([^\]]*)\]/g)) for (const s of m[1].matchAll(/'([^']*)'/g)) out.push(s[1])
  return out
}

const ALLOW: readonly string[] = [
  'src/features/explain/context/diff.ts',
  'src/features/forecast/ForecastGrid.tsx',
  'src/features/forecast/ForecastZoom.tsx',
]

describe('заголовки таблиц — без сокращений', () => {
  it('правило ловит сокращения и пропускает полные фразы', () => {
    for (const bad of ['Кол-во', 'Таб. №', 'Тип РЦ', 'E[Cmax], ч', 'CVaR, ч', 'OTD', 'P10', '95 %-ДИ', 'Δ', 'Ед.', 'Σ норм. время, мин']) {
      expect(HEADER_DENY.test(bad), bad).toBe(true)
    }
    for (const ok of ['Количество, шт', 'Табельный номер', 'Тип оборудования', 'Нижняя граница (P10)', 'Средняя длина плана, ч', 'Единица', 'Разница с базой']) {
      expect(HEADER_DENY.test(ok), ok).toBe(false)
    }
  })

  it('новых файлов с сокращёнными заголовками нет (ALLOW сокращается)', () => {
    const files = [...walk(join(SRC, 'features')), ...walk(join(SRC, 'ui'))]
      .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f))
    const hits = files
      .map((abs) => ({ path: relative(ROOT, abs).split('\\').join('/'), bad: headerTexts(readFileSync(abs, 'utf8')).filter((h) => HEADER_DENY.test(h)) }))
      .filter((f) => f.bad.length > 0)
    const fresh = hits.filter((h) => !ALLOW.includes(h.path)).map((h) => `${h.path}: ${h.bad.join(' | ')}`)
    expect(fresh, 'новые сокращения в заголовках таблиц — напишите полную фразу, аббревиатуру — в «i»').toEqual([])
    expect(hits.filter((h) => h.path.startsWith('src/ui/')).map((h) => h.path), 'кит и графики — без сокращений').toEqual([])
    const fixed = ALLOW.filter((p) => !hits.some((h) => h.path === p))
    if (fixed.length) console.warn(`[table-vocabulary] уже исправлено, удалите из ALLOW: ${fixed.join(', ')}`)
  })
})
