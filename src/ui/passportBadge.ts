/**
 * Бейдж происхождения (UX-V2 §5.2, METHODOLOGY-V2 §3.2): один словарь для серверного статуса
 * паспорта (Н/О/К/НОРМ/UI/техн./синтетика) и происхождения карты (`Provenance`).
 * Глифы и слова — из единого словаря src/ui/stateVocabulary.ts: ● по данным · ◆ норматив · ■ вручную ·
 * ○ по умолчанию (поглощает «для UI» и «код») · ▲ устарело/синтетика; «в плане» — пунктирная рамка без глифа. Буквенный код паспорта (`code`) показывается
 * только в таблице паспорта; в интерфейсе бейдж — глиф + короткое человеческое слово (`short`).
 * Правило: [К] и [НОРМ] никогда не подписываются «оценено»; «UI» с пометкой deprecated —
 * «не в расчёте»; синтетика — предупреждающий тон, чтобы демо-данные не читались как факт.
 * Чистые функции — проверяются тестом.
 */
import type { Provenance, Stage } from '../features/method-map/types'
import type { PassportStatus } from '../lib/api'
import { VOCABULARY } from './stateVocabulary'

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
  /** Глиф словаря состояний: ● ◆ ■ ○ ▲; у «в плане» — пусто (пунктирная рамка). */
  glyph: string
}

const V = VOCABULARY

/** Производные от единого словаря (stateVocabulary.ts): глиф и слово — оттуда, подробность — в label. */
const SPECS: Readonly<Record<BadgeKey, BadgeSpec>> = {
  observed:   { key: 'observed',   short: V.data.word, code: 'Н',    label: 'по данным: наблюдение',                 tone: 'good',    glyph: V.data.glyph },
  estimated:  { key: 'estimated',  short: V.data.word, code: 'О',    label: V.data.label,                            tone: 'good',    glyph: V.data.glyph },
  calibrated: { key: 'calibrated', short: V.data.word, code: 'К',    label: 'по данным: калибровка по план-факту',   tone: 'good',    glyph: V.data.glyph },
  normative:  { key: 'normative',  short: V.normative.word, code: 'НОРМ', label: V.normative.label,                tone: 'neutral', glyph: V.normative.glyph },
  ui:         { key: 'ui',         short: V.default.word, code: 'UI', label: 'по умолчанию: подобрано для интерфейса', tone: 'muted', glyph: V.default.glyph },
  deprecated: { key: 'deprecated', short: 'не в расчёте', code: 'UI', label: 'принимается API, в расчёте не используется', tone: 'warn', glyph: V.stale.glyph },
  synthetic:  { key: 'synthetic',  short: 'синтетика',  code: 'СИНТ', label: 'синтетические данные — демонстрация, не факт', tone: 'warn', glyph: V.stale.glyph },
  technical:  { key: 'technical',  short: V.default.word, code: 'ТЕХН', label: 'по умолчанию: константа кода',   tone: 'muted',   glyph: V.default.glyph },
  manual:     { key: 'manual',     short: V.manual.word, code: 'В',  label: V.manual.label,                          tone: 'neutral', glyph: V.manual.glyph },
  default:    { key: 'default',    short: V.default.word, code: '—', label: 'по умолчанию кода/НСИ',                tone: 'muted',   glyph: V.default.glyph },
  planned:    { key: 'planned',    short: V.planned.word, code: '…', label: V.planned.label,                        tone: 'muted',   glyph: V.planned.glyph },
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

/**
 * Бейдж поля: серверный статус паспорта или происхождение карты. «Вручную» побеждает статус
 * (поле, которое пользователь изменил, никогда не подписывается «норматив»); волна «в плане» — всё.
 */
export function badgeForField({ provenance, status, deprecated, stage }: {
  provenance?: Provenance; status?: PassportStatus | string; deprecated?: boolean; stage?: Stage
}): BadgeSpec {
  if (stage && stage !== 'done') return SPECS.planned
  if (provenance === 'manual') return SPECS.manual
  if (status !== undefined) return badgeForStatus(status, { deprecated })
  return badgeForProvenance(provenance ?? 'default', { deprecated, stage })
}

/** Подпись владельца значения (UX-V2 §4.3). */
export function ownerLabel(owner: 'project' | 'scenario' | 'run', scenarioName?: string): string {
  if (owner === 'project') return 'из НСИ / проекта'
  if (owner === 'scenario') return scenarioName ? `из сценария «${scenarioName}»` : 'из сценария'
  return 'этот прогон'
}
