/**
 * Бейдж происхождения (UX-V2 §5.2, METHODOLOGY-V2 §3.2): один словарь для серверного статуса
 * паспорта (Н/О/К/НОРМ/UI/техн./синтетика) и происхождения карты (`Provenance`).
 * Глифы — те же, что у состояний узлов карты (stateMeta): ● оценено · ■ вручную · ◆ норматив ·
 * ○ по умолчанию · ▲ устарело/синтетика · ◌ в плане. Буквенный код паспорта (`code`) показывается
 * только в таблице паспорта; в интерфейсе бейдж — глиф + короткое человеческое слово (`short`).
 * Правило: [К] и [НОРМ] никогда не подписываются «оценено»; «UI» с пометкой deprecated —
 * «не в расчёте»; синтетика — предупреждающий тон, чтобы демо-данные не читались как факт.
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
  /** Короткая человеческая подпись бейджа: «оценено», «вручную», «норматив»… */
  short: string
  /** Буквенный код паспорта: «О», «К», «НОРМ», «UI»… — только внутри паспорта. */
  code: string
  /** Полная подпись для подсказки и панели. */
  label: string
  tone: BadgeTone
  /** Глиф состояния (как на карте): ● ■ ◆ ○ ▲ ◌. */
  glyph: string
}

const SPECS: Readonly<Record<BadgeKey, BadgeSpec>> = {
  observed:   { key: 'observed',   short: 'наблюдение', code: 'Н',    label: 'наблюдение',           tone: 'good',    glyph: '●' },
  estimated:  { key: 'estimated',  short: 'оценено',    code: 'О',    label: 'оценено по данным',    tone: 'good',    glyph: '●' },
  calibrated: { key: 'calibrated', short: 'калибровка', code: 'К',    label: 'калибровка',           tone: 'neutral', glyph: '●' },
  normative:  { key: 'normative',  short: 'норматив',   code: 'НОРМ', label: 'норматив',             tone: 'neutral', glyph: '◆' },
  ui:         { key: 'ui',         short: 'для UI',     code: 'UI',   label: 'подобрано для UI',     tone: 'muted',   glyph: '○' },
  deprecated: { key: 'deprecated', short: 'не в расчёте', code: 'UI', label: 'принимается API, в расчёте не используется', tone: 'warn', glyph: '▲' },
  synthetic:  { key: 'synthetic',  short: 'синтетика',  code: 'СИНТ', label: 'синтетические данные', tone: 'warn',    glyph: '▲' },
  technical:  { key: 'technical',  short: 'код',        code: 'ТЕХН', label: 'константа кода',       tone: 'muted',   glyph: '○' },
  manual:     { key: 'manual',     short: 'вручную',    code: 'В',    label: 'задано вручную',       tone: 'neutral', glyph: '■' },
  default:    { key: 'default',    short: 'по умолч.',  code: '—',    label: 'по умолчанию кода/НСИ', tone: 'muted', glyph: '○' },
  planned:    { key: 'planned',    short: 'в плане',    code: '…',    label: 'ещё не реализовано',   tone: 'muted',   glyph: '◌' },
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
