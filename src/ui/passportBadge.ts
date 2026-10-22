/**
 * Бейдж происхождения (UX-V2 §5.2, METHODOLOGY-V2 §3.2): один словарь для серверного статуса
 * паспорта (Н/О/К/НОРМ/UI/техн./синтетика) и происхождения карты (`Provenance`).
 * Правило: [К] и [НОРМ] никогда не подписываются «оценено»; «UI» с пометкой deprecated —
 * «не используется»; синтетика — отдельный тон, чтобы демо-данные не читались как факт.
 * Чистые функции — проверяются тестом.
 */
import type { Provenance, Stage } from '../features/method-map/types'
import type { PassportStatus } from '../lib/api'

export type BadgeKey =
  | 'observed' | 'estimated' | 'calibrated' | 'normative' | 'ui' | 'deprecated' | 'synthetic'
  | 'technical' | 'manual' | 'default' | 'planned'

/** Тон — только токены статусов (цвет + глиф, никогда цвет один). */
export type BadgeTone = 'good' | 'neutral' | 'warn' | 'muted' | 'bad'

export interface BadgeSpec {
  key: BadgeKey
  /** Короткая метка в caps: «О», «К», «НОРМ», «UI»… */
  short: string
  /** Полная подпись для подсказки и панели. */
  label: string
  tone: BadgeTone
  /** Глиф состояния (как на карте): ● ■ ○ ▲ ◌. */
  glyph: string
}

const SPECS: Readonly<Record<BadgeKey, BadgeSpec>> = {
  observed:   { key: 'observed',   short: 'Н',    label: 'наблюдение',           tone: 'good',    glyph: '●' },
  estimated:  { key: 'estimated',  short: 'О',    label: 'оценено по данным',    tone: 'good',    glyph: '●' },
  calibrated: { key: 'calibrated', short: 'К',    label: 'калибровка',           tone: 'neutral', glyph: '■' },
  normative:  { key: 'normative',  short: 'НОРМ', label: 'норматив',             tone: 'neutral', glyph: '■' },
  ui:         { key: 'ui',         short: 'UI',   label: 'подобрано для UI',     tone: 'muted',   glyph: '○' },
  deprecated: { key: 'deprecated', short: 'UI · не в расчёте', label: 'принимается API, в расчёте не используется', tone: 'warn', glyph: '▲' },
  synthetic:  { key: 'synthetic',  short: 'СИНТ', label: 'синтетические данные', tone: 'warn',    glyph: '▲' },
  technical:  { key: 'technical',  short: 'ТЕХН', label: 'константа кода',       tone: 'muted',   glyph: '○' },
  manual:     { key: 'manual',     short: 'ВРУЧНУЮ', label: 'задано вручную',    tone: 'neutral', glyph: '■' },
  default:    { key: 'default',    short: 'ПО УМОЛЧ.', label: 'по умолчанию кода/НСИ', tone: 'muted', glyph: '○' },
  planned:    { key: 'planned',    short: 'В ПЛАНЕ', label: 'ещё не реализовано', tone: 'muted',  glyph: '◌' },
}

export function badgeSpec(key: BadgeKey): BadgeSpec {
  return SPECS[key]
}

/** Статус серверного паспорта → бейдж. `deprecated` переводит «UI» в «не в расчёте». */
export function badgeForStatus(status: PassportStatus | string | undefined, opts: { deprecated?: boolean } = {}): BadgeSpec {
  switch (status) {
    case 'Н': return SPECS.observed
    case 'О': return SPECS.estimated
    case 'К': return SPECS.calibrated
    case 'НОРМ': return SPECS.normative
    case 'UI': return opts.deprecated ? SPECS.deprecated : SPECS.ui
    case 'синтетика': return SPECS.synthetic
    case 'техн.': return SPECS.technical
    default: return opts.deprecated ? SPECS.deprecated : SPECS.default
  }
}

/** Происхождение карты → бейдж; волна в плане перекрывает всё. */
export function badgeForProvenance(p: Provenance, opts: { deprecated?: boolean; stage?: Stage } = {}): BadgeSpec {
  if (opts.stage && opts.stage !== 'done') return SPECS.planned
  if (opts.deprecated) return SPECS.deprecated
  switch (p) {
    case 'observed': return SPECS.observed
    case 'estimated': return SPECS.estimated
    case 'calibrated': return SPECS.calibrated
    case 'normative': return SPECS.normative
    case 'ui': return SPECS.ui
    case 'synthetic': return SPECS.synthetic
    case 'manual': return SPECS.manual
    default: return SPECS.default
  }
}

/** Подпись владельца значения (UX-V2 §4.3). */
export function ownerLabel(owner: 'project' | 'scenario' | 'run', scenarioName?: string): string {
  if (owner === 'project') return 'из НСИ / проекта'
  if (owner === 'scenario') return scenarioName ? `из сценария «${scenarioName}»` : 'из сценария'
  return 'этот прогон'
}
