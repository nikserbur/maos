/**
 * Поле с паспортом (UX-V2 §4.3, §5.1): значение крупно (20 px), единица на шаг меньше и
 * приглушённо, происхождение — бейдж 11 px caps, подпись владельца («из сценария «Базовый»»,
 * «этот прогон»); изменённое в потоке значение получает рамку и чип «изменено · вернуть»;
 * вне разумного диапазона — ▲ с подсказкой; «накопленный эффект за горизонт» — рядом с полем.
 * Ввод — число всегда; ползунок — по желанию (дебаунс делает вызывающий код).
 */
import { useId, type ReactNode } from 'react'
import type { Provenance, Stage } from '../features/method-map/types'
import { InfoTip } from './InfoTip'
import { ProvenanceBadge } from './ProvenanceBadge'
import './fields.css'

export interface ParamFieldProps {
  label: string
  /** Текущее значение (число для ввода или готовая строка для read-only). */
  value: number | string | null
  unit?: string
  provenance?: Provenance
  status?: string
  deprecated?: boolean
  stage?: Stage
  /** Подпись владельца: «из НСИ», «из сценария «Базовый»», «из портфеля 10-21», «этот прогон». */
  owner?: string
  /** Значение изменено в этом потоке относительно унаследованного. */
  changed?: boolean
  onRevert?: () => void
  /** Разумный диапазон — предупреждение, не запрет. */
  range?: [number, number]
  step?: number
  min?: number
  max?: number
  /** «за 13 мес +188 %» и т. п. */
  effect?: ReactNode
  note?: ReactNode
  /** id записи реестра «i». */
  info?: string
  infoValues?: Readonly<Record<string, number | string | null | undefined>>
  onChange?: (v: number) => void
  slider?: boolean
  readOnly?: boolean
  actions?: ReactNode
  /** Компактный вид — для списков в мастере. */
  size?: 'md' | 'lg'
  /** Произвольный контрол вместо числового ввода. */
  children?: ReactNode
}

export function ParamField({
  label, value, unit, provenance, status, deprecated, stage, owner, changed, onRevert, range, step, min, max,
  effect, note, info, infoValues, onChange, slider = false, readOnly = false, actions, size = 'md', children,
}: ParamFieldProps) {
  const id = useId()
  const numeric = typeof value === 'number' && Number.isFinite(value)
  const outOfRange = numeric && range ? value < range[0] || value > range[1] : false
  const editable = !readOnly && Boolean(onChange) && !children
  const lo = min ?? range?.[0]
  const hi = max ?? range?.[1]
  const cls = [
    'pf-field',
    `pf-field--${size}`,
    changed ? 'is-changed' : '',
    outOfRange ? 'is-warn' : '',
    deprecated ? 'is-deprecated' : '',
    readOnly || !editable ? 'is-readonly' : '',
  ].filter(Boolean).join(' ')
  return (
    <div className={cls} role="group" aria-labelledby={`${id}-l`}>
      <div className="pf-field__head">
        <label className="pf-field__label text-caps" id={`${id}-l`} htmlFor={editable ? id : undefined}>
          {label}
          {info && <InfoTip id={info} values={infoValues} />}
        </label>
        <ProvenanceBadge provenance={provenance} status={status} deprecated={deprecated} stage={stage} />
      </div>
      <div className="pf-field__row">
        {children ? (
          <div className="pf-field__control">{children}</div>
        ) : editable ? (
          <span className="pf-field__input-wrap">
            <input
              id={id}
              className="pf-field__input num"
              type="number"
              value={numeric ? value : ''}
              step={step}
              min={lo}
              max={hi}
              onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) onChange?.(v) }}
            />
            {unit && <span className="pf-field__unit">{unit}</span>}
          </span>
        ) : (
          <span className="pf-field__value num">
            {value === null || value === '' ? '—' : typeof value === 'number' ? formatNum(value) : value}
            {unit && value !== null && <span className="pf-field__unit">{unit}</span>}
          </span>
        )}
        {changed && (
          <span className="pf-field__changed">
            изменено
            {onRevert && <button type="button" className="pf-field__revert" onClick={onRevert}>· вернуть</button>}
          </span>
        )}
        {outOfRange && range && (
          <span className="pf-field__warn glyph-setup" title={`разумный диапазон ${formatNum(range[0])}–${formatNum(range[1])}`}>
            вне диапазона {formatNum(range[0])}–{formatNum(range[1])}
          </span>
        )}
      </div>
      {slider && editable && lo !== undefined && hi !== undefined && (
        <input
          className="pf-field__slider"
          type="range"
          aria-label={`${label}, ползунок`}
          min={lo}
          max={hi}
          step={step ?? (hi - lo) / 100}
          value={numeric ? Math.min(hi, Math.max(lo, value)) : lo}
          onChange={(e) => onChange?.(Number(e.target.value))}
        />
      )}
      {(owner || effect) && (
        <div className="pf-field__meta">
          {owner && <span className="pf-field__owner">{owner}</span>}
          {effect && <span className="pf-field__effect">{effect}</span>}
        </div>
      )}
      {note && <p className="pf-field__note">{note}</p>}
      {actions && <div className="pf-field__actions">{actions}</div>}
    </div>
  )
}

function formatNum(v: number): string {
  const abs = Math.abs(v)
  const digits = abs >= 1000 ? 0 : abs >= 100 ? 1 : abs >= 1 ? 2 : 3
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(v)
}
