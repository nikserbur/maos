/**
 * Плитка показателя единого кита (X2 «ответ сначала»): подпись (капители без порчи греческих букв) +
 * «i» из реестра метрик · значение · единица · глиф+слово состояния · Δ к названной базе · интервал
 * (или RangeStrip) рядом с числом. Число — готовая строка форматтера (src/explain/format.ts).
 * Прежний API плитки «Плана» (span/hero/status/children) сохранён: plan/kpiParts реэкспортирует кит.
 *
 * TailStrip — полоса хвоста риска длины расписания (○ дет. · ● E · ▲ CVaR · ■ худший) на RangeStrip.
 */
import type { ReactNode } from 'react'
import { InfoTip, type InfoTipValues } from '../InfoTip'
import { hours, num, pct } from '../../explain/format'
import { RangeStrip, type RangeMark } from '../charts'
import { CapsLabel } from './CapsLabel'
import { DeltaChip, type DeltaBetter } from './DeltaChip'
import './kit.css'

/** «1,23 млн ₽» → ["1,23", "млн ₽"]; «93,4 %» → ["93,4", "%"]; без единицы — [текст, ""]. */
export function splitUnit(text: string): [string, string] {
  const m = /^([−+]?[\d,\s ]*\d)[\s ](.+)$/u.exec(text)
  return m ? [m[1], m[2]] : [text, '']
}

export interface KpiDelta {
  value: number | null | undefined
  better?: DeltaBetter
  /** Названная база: «№27», «Базовый». */
  base?: string
  fmt?: (v: number) => string
}

export interface KpiTileProps {
  /** Id метрики реестра src/explain/metrics.* — «i» рядом с подписью (обязателен: у каждого числа есть объяснение). */
  metric: string
  label: string
  values?: InfoTipValues
  /** Значение — строка форматтера («1,23 млн ₽»); единица отделяется автоматически. */
  value?: string
  /** Единица отдельно, если `value` — голое число. */
  unit?: string
  size?: 'hero' | 'md' | 'sm'
  /** Отклонение: глиф (класс glyphs.css) + слово. Нормальное состояние не подписывается. */
  state?: { glyph: 'glyph-setup' | 'glyph-down' | 'glyph-x' | 'glyph-idle' | 'glyph-info'; word: string }
  delta?: KpiDelta
  /** Интервал рядом с числом: «P10–P90 · 54–86,7 тыс. ₽ · N = 1000» или RangeStrip. */
  interval?: ReactNode
  /** Прежний слот справа от подписи (бейдж). */
  status?: ReactNode
  /** Прежняя раскладка «Плана»: ширина в сетке и герой. */
  span?: 's3' | 's4' | 's5' | 's7'
  hero?: boolean
  className?: string
  children?: ReactNode
}

export function KpiTile({
  metric, label, values, value, unit, size, state, delta, interval, status, span, hero = false, className, children,
}: KpiTileProps) {
  const [n, u] = value !== undefined ? (unit ? [value, unit] : splitUnit(value)) : ['', '']
  const vSize = size ?? (hero ? 'hero' : 'md')
  const cls = ['dk-kpitile', span && span !== 's3' ? `dk-kpitile--${span}` : '', hero ? 'dk-kpitile--hero' : '', className ?? ''].filter(Boolean).join(' ')
  return (
    <div className={cls} role="group" aria-label={label}>
      <div className="dk-kpitile__k">
        <span className="dk-kpitile__label text-caps"><CapsLabel text={label} /><InfoTip id={metric} values={values} /></span>
        {status}
      </div>
      {value !== undefined && (
        <div className={`dk-kpitile__v dk-kpitile__v--${vSize} num`}>
          {n}{u && <span className="unit">{u}</span>}
        </div>
      )}
      {state && <span className={`dk-kpitile__state ${state.glyph}`}>{state.word}</span>}
      {(delta || interval) && (
        <div className="dk-kpitile__foot">
          {delta && <DeltaChip value={delta.value} better={delta.better} base={delta.base} fmt={delta.fmt} />}
          {interval && <span className="dk-kpitile__interval">{interval}</span>}
        </div>
      )}
      {children}
    </div>
  )
}

/* ── Хвост риска длины расписания ────────────────────────────────────────── */

export interface TailStripProps {
  det: number; mean: number; cvar: number; worst: number
  /** Доля худших сценариев хвоста (0,1 → «10 % худших»); без неё — «средняя по худшим». */
  alpha?: number
}

/**
 * Подписи словами (владелец: «сокращения — нечитаемо»): без сбоев · средняя · средняя по 10 % худших ·
 * худший прогон; формулы (E[Cmax], CVaR) — только в «i» плитки. Числом — только хвост и худший
 * (X1: ≤ 14 чисел выше сгиба).
 */
export function TailStrip({ det, mean, cvar, worst, alpha }: TailStripProps) {
  const tail = alpha !== undefined && alpha > 0 && alpha < 1 ? `средняя по ${pct(alpha, 0)} худших` : 'средняя по худшим'
  const marks: RangeMark[] = [
    { key: 'det', value: det, label: 'без сбоев (по Ганту)', glyph: 'ring', tone: 'idle' },
    { key: 'mean', value: mean, label: 'средняя', glyph: 'dot', tone: 'accent' },
    { key: 'cvar', value: cvar, label: tail, glyph: 'triangle', tone: 'warn', showValue: true },
    { key: 'worst', value: worst, label: 'худший прогон', glyph: 'square', tone: 'danger', showValue: true },
  ]
  return (
    <div>
      <RangeStrip marks={marks} fmt={(v) => num(v, 1)} zone={worst > cvar ? [cvar, worst] : undefined} zoneLabel="от средней по худшим до худшего"
        ariaLabel={`Длина расписания: без сбоев ${hours(det)}, средняя ${hours(mean)}, ${tail} ${hours(cvar)}, худший прогон ${hours(worst)}`} />
      <div className="dk-tail-legend">
        <span className="glyph-idle" title={`без сбоев (по Ганту): ${hours(det)}`}>без сбоев</span>
        <span className="dk-tail-legend__mean">средняя</span>
        <span className="glyph-setup">{tail}</span>
        <span className="glyph-down">худший прогон, ч</span>
      </div>
    </div>
  )
}
