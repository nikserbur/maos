/**
 * Поле с паспортом (UX-V2 §4.3, §5.1; владелец: «карточки параметров — ужасно»). Сверху вниз:
 *  подпись обычным регистром на всю ширину, «i» — в строке текста (переносится с последним словом);
 *  значение + единица одной группой по базовой линии (ввод — по ширине числа);
 *  эффект — одна строка («≈ 0,51 %/мес · за 6 мес прогноза +3,1 %»);
 *  мета-строка: происхождение маленьким глифом и словом/источником («● ЦБ РФ, сент. 2026»),
 *  у изменённого — «✎ изменено · вернуть к 0,50 (норматив)» (к чему и откуда — словами, а не «■ вернуть»,
 *  похожее на пустой флажок), подпись владельца («из сценария «Базовый»»).
 * Никаких CAPS-пилюль в шапке; вне разумного диапазона — «▲ обычно от −20 до +30 %» (знак у
 * границ и единица), карточки в ряду — равной высоты.
 * Ввод — число всегда; ползунок — по желанию (дебаунс делает вызывающий код).
 * Режим `collapsedSlider` (X1 §3.1): ползунок спрятан и появляется только при фокусе или
 * намерении навести курсор — поле остаётся компактным в сетке 4 колонок; длинные заметки
 * уходят в «i» (`hint`), предупреждение «вне диапазона» остаётся на месте.
 */
import { useId, useRef, useState, type ReactNode } from 'react'
import type { Provenance, Stage } from '../features/method-map/types'
import { NBSP, num } from '../explain/format'
import { InfoTip } from './InfoTip'
import { NoteTip } from './NoteTip'
import { ProvenanceBadge } from './ProvenanceBadge'
import { splitGreek } from './labelParts'
import './fields.css'

/** Задержка «намерения навести»: случайное пересечение курсором ползунок не раскрывает. */
const HOVER_INTENT_MS = 180

export interface ParamFieldProps {
  label: string
  /** Текущее значение (число для ввода или готовая строка для read-only). */
  value: number | string | null
  unit?: string
  provenance?: Provenance
  status?: string
  deprecated?: boolean
  stage?: Stage
  /** Источник значения словами — вместо короткого слова бейджа: «ЦБ РФ, сент. 2026», «НСИ», «история ряда». */
  source?: string
  /** Не показывать происхождение (оно уже названо рядом, например в заголовке группы). */
  hideProvenance?: boolean
  /** Подпись владельца: «из НСИ», «из сценария «Базовый»», «из портфеля 10-21», «этот прогон». */
  owner?: string
  /** Значение изменено в этом потоке относительно унаследованного. */
  changed?: boolean
  onRevert?: () => void
  /** К чему вернёт «вернуть»: исходное значение (в единицах поля) — «вернуть к 0,50». */
  revertTo?: number | string
  /** Откуда исходное значение: «норматив», «генератор», «НСИ» — «вернуть к 0,50 (норматив)». */
  revertSource?: string
  /** Разумный диапазон — предупреждение, не запрет. */
  range?: [number, number]
  step?: number
  min?: number
  max?: number
  /** «за 13 мес +188 %» и т. п. */
  effect?: ReactNode
  /** Заметка под полем (виден всегда); для компактных сеток предпочитайте `hint`. */
  note?: ReactNode
  /** Пояснение в «i»: к записи реестра (`info`) добавляется примечанием, без реестра — отдельный поповер. */
  hint?: ReactNode
  /** id записи реестра «i». */
  info?: string
  infoValues?: Readonly<Record<string, number | string | null | undefined>>
  onChange?: (v: number) => void
  slider?: boolean
  /** Ползунок скрыт и показывается по фокусу/наведению (сетки «Условий»). */
  collapsedSlider?: boolean
  readOnly?: boolean
  actions?: ReactNode
  /** Компактный вид — для списков в мастере. */
  size?: 'md' | 'lg'
  /** Произвольный контрол вместо числового ввода. */
  children?: ReactNode
}

export function ParamField({
  label, value, unit, provenance, status, deprecated, stage, source, hideProvenance = false, owner, changed, onRevert, revertTo, revertSource, range, step, min, max,
  effect, note, hint, info, infoValues, onChange, slider = false, collapsedSlider = false, readOnly = false, actions, size = 'md', children,
}: ParamFieldProps) {
  const id = useId()
  const [peek, setPeek] = useState(false)
  const hoverTimer = useRef<number>()
  const numeric = typeof value === 'number' && Number.isFinite(value)
  const outOfRange = numeric && range ? value < range[0] || value > range[1] : false
  const editable = !readOnly && Boolean(onChange) && !children
  const lo = min ?? range?.[0]
  const hi = max ?? range?.[1]
  const hasSlider = slider && editable && lo !== undefined && hi !== undefined
  const collapsed = hasSlider && collapsedSlider
  const cls = [
    'pf-field',
    `pf-field--${size}`,
    collapsed ? 'pf-field--collapsed' : '',
    collapsed && peek ? 'is-peek' : '',
    changed ? 'is-changed' : '',
    outOfRange ? 'is-warn' : '',
    deprecated ? 'is-deprecated' : '',
    readOnly || !editable ? 'is-readonly' : '',
  ].filter(Boolean).join(' ')

  // Намерение навести: раскрываем ползунок только после короткой задержки, убираем сразу.
  const onEnter = () => {
    if (!collapsed) return
    window.clearTimeout(hoverTimer.current)
    hoverTimer.current = window.setTimeout(() => setPeek(true), HOVER_INTENT_MS)
  }
  const onLeave = () => {
    if (!collapsed) return
    window.clearTimeout(hoverTimer.current)
    setPeek(false)
  }

  return (
    <div className={cls} role="group" aria-labelledby={`${id}-l`} onMouseEnter={onEnter} onMouseLeave={onLeave}>
      <label className="pf-field__label" id={`${id}-l`} htmlFor={editable ? id : undefined}>
        {label}
        {info ? <>{'\u00A0'}<InfoTip id={info} values={infoValues} note={hint} /></> : hint ? <>{'\u00A0'}<NoteTip title={label}>{hint}</NoteTip></> : null}
      </label>
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
        {outOfRange && range && (
          <span className="pf-field__warn glyph-setup" title={`Значение вне обычного диапазона: ${rangeText(range, unit)}. Это предупреждение, не запрет.`}>
            обычно {rangeText(range, unit)}
          </span>
        )}
      </div>
      {effect && <div className="pf-field__effect">{effect}</div>}
      {hasSlider && (
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
      {(changed || owner || !hideProvenance) && (
        <div className="pf-field__meta">
          {changed ? (
            <span className="pf-field__changed" data-key="manual"><span className="pf-field__changed-glyph" aria-hidden="true">✎</span>изменено</span>
          ) : !hideProvenance && (
            <ProvenanceBadge provenance={provenance} status={status} deprecated={deprecated} stage={stage} source={source} variant="inline" />
          )}
          {changed && onRevert && (
            <button type="button" className="pf-field__revert" onClick={onRevert}>{revertText(revertTo, unit, revertSource)}</button>
          )}
          {owner && <span className="pf-field__owner">{owner}</span>}
        </div>
      )}
      {note && <p className="pf-field__note">{note}</p>}
      {actions && <div className="pf-field__actions">{actions}</div>}
    </div>
  )
}

/** @deprecated Подписи полей — обычным регистром. Капители: греческие буквы (α, σ, ρ…) не переводятся в верхний регистр. */
export function CapsLabel({ text }: { text: string }) {
  return <>{splitGreek(text).map((p, i) => (p.greek ? <span key={i} className="pf-nocaps">{p.text}</span> : p.text))}</>
}

function formatNum(v: number): string {
  const abs = Math.abs(v)
  const digits = abs >= 1000 ? 0 : abs >= 100 ? 1 : abs >= 1 ? 2 : 3
  return num(v, digits)
}

/** Граница со знаком, если диапазон переходит через ноль: «−20» и «+30» (а не «−20–30» = «от −20 до −30»). */
function signedBound(v: number, signed: boolean): string {
  return signed && v > 0 ? `+${formatNum(v)}` : formatNum(v)
}

/** «от −20 до +30 %»: знак у границ, когда диапазон переходит через ноль, единица — в конце. */
export function rangeText(range: readonly [number, number], unit?: string): string {
  const signed = range[0] < 0
  return `от ${signedBound(range[0], signed)} до ${signedBound(range[1], signed)}${unit ? `${NBSP}${unit}` : ''}`
}

/** «вернуть к 0,50 (норматив)» · «вернуть исходное» — к чему вернёт кнопка, словами. */
export function revertText(to: number | string | undefined, unit?: string, source?: string): string {
  if (to === undefined || to === '') return source ? `вернуть исходное (${source})` : 'вернуть исходное'
  const v = typeof to === 'number' ? formatNum(to) : to
  return `вернуть к ${v}${unit ? `${NBSP}${unit}` : ''}${source ? ` (${source})` : ''}`
}
