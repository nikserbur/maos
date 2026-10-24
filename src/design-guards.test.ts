/**
 * Охрана дизайн-системы (X2 P-26): сканирует src/features и src/ui и ловит то, что ломает единый
 * язык интерфейса:
 *  - цвет литералом (hex/oklch) вне src/styles/tokens.css;
 *  - форматирование чисел мимо src/explain/format.ts (.toFixed( · toLocaleString( · Intl.NumberFormat);
 *  - проглоченная ошибка `.catch(() => {})` (ошибка должна дойти до пользователя простыми словами);
 *  - акцент (--accent) в CSS графиков (данные ≠ взаимодействие);
 *  - поворот подписей осей графиков (rotate( в Axis);
 *  - статусный цвет (--status-* / --intent-*) как цвет текста у классов чисел (__v, __value, .num, kpi-hero).
 *
 * ALLOW — явный список текущих нарушителей; каждая волна его сокращает, цель — пустой список.
 * Новое нарушение (файл не в списке) — ошибка теста. Исправленный, но оставшийся в списке файл —
 * предупреждение в консоли: удалите его из ALLOW.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = fileURLToPath(new URL('.', import.meta.url))
const ROOT = join(SRC, '..')

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}

const FILES = [...walk(join(SRC, 'features')), ...walk(join(SRC, 'ui'))]
  .filter((f) => /\.(css|ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f))
  .map((abs) => ({ path: relative(ROOT, abs).split('\\').join('/'), text: readFileSync(abs, 'utf8') }))

const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

type Rule = 'colorLiteral' | 'numberFormat' | 'swallowedCatch' | 'accentInCharts' | 'rotateInAxes' | 'statusOnNumbers'

const RULES: Readonly<Record<Rule, (text: string, path: string) => boolean>> = {
  colorLiteral: (text) => {
    const code = stripComments(text)
    return /(?<![\w&/#])#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b(?![\w-])/.test(code) || /oklch\(/.test(code)
  },
  numberFormat: (text, path) => /\.(ts|tsx)$/.test(path) && /\.toFixed\(|toLocaleString\(|Intl\.NumberFormat/.test(stripComments(text)),
  swallowedCatch: (text) => /\.catch\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)/.test(text),
  accentInCharts: (text, path) => path.includes('/ui/charts/') && path.endsWith('.css') && /var\(--accent\)/.test(text),
  rotateInAxes: (text, path) => path.includes('/ui/charts/') && /Axis/.test(path) && /rotate\(/.test(stripComments(text)),
  statusOnNumbers: (text, path) => path.endsWith('.css') && [...stripComments(text).matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .some(([, sel, body]) => /(__v\b|__value|\.num\b|kpi-hero|__num\b)/.test(sel) && /(^|[;\s])color:\s*var\(--(status|intent)-/.test(body)),
}

/** Текущие нарушители (сокращается каждой волной; цель — пусто). */
const ALLOW: Readonly<Record<Rule, readonly string[]>> = {
  colorLiteral: [
    'src/features/forecast/forecast.css',
    'src/features/plant-scene/themeColors.ts', // three.js: материалы читают цвета из токенов, здесь — запасные значения
    'src/features/workflow-builder/types.ts',
  ],
  numberFormat: [],
  swallowedCatch: [
    'src/features/admin/AdminScreen.tsx',
    'src/features/forecast/ForecastScreen.tsx',
    'src/features/nsi/NsiScreen.tsx',
    'src/features/nsi/useNsi.ts',
    'src/features/plan/heuristicPresets.ts',
    'src/features/plan/wizard/steps/ProgramStep.tsx',
    'src/features/plan/wizard/useWizardData.ts',
    'src/features/plant-scene/PlantScene.tsx',
    'src/features/scenarios/ScenarioCompareScreen.tsx',
    'src/features/scenarios/ScenariosScreen.tsx',
  ],
  accentInCharts: [],
  rotateInAxes: [],
  statusOnNumbers: [
    'src/features/method-map/map.css',
    'src/features/optimization/optimization.css',
  ],
}

describe('design guards — единый язык интерфейса', () => {
  it.each(Object.keys(RULES) as Rule[])('%s: нарушений вне списка ALLOW нет', (rule) => {
    const hits = FILES.filter((f) => RULES[rule](f.text, f.path)).map((f) => f.path)
    const allowed = new Set(ALLOW[rule])
    const fresh = hits.filter((p) => !allowed.has(p))
    expect(fresh, `${rule}: новые нарушения — исправьте (см. шапку теста)`).toEqual([])
    const fixed = ALLOW[rule].filter((p) => !hits.includes(p))
    if (fixed.length) console.warn(`[design-guards] ${rule}: уже исправлено, удалите из ALLOW: ${fixed.join(', ')}`)
  })

  it('кит и графики (src/ui) — уже чистые: ни одного нарушения', () => {
    for (const rule of Object.keys(RULES) as Rule[]) {
      const uiHits = FILES.filter((f) => f.path.startsWith('src/ui/') && RULES[rule](f.text, f.path)).map((f) => f.path)
      expect(uiHits, rule).toEqual([])
    }
  })

  it('сканер видит файлы', () => {
    expect(FILES.length).toBeGreaterThan(100)
  })
})
