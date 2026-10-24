/**
 * Сегментный переключатель — только режим/вид/фильтр одного и того же содержимого (2–5 коротких
 * вариантов, применяется сразу). Компактный скруглённый прямоугольник (не «таблетка»): sm 24 px —
 * панели инструментов, md 30 px — формы. Ширина — по содержимому, никогда не растягивается и не
 * обрезает подписи; строка с сегментом переносится раньше (kit.css), и только если не помещается
 * даже одна — выпадающий список той же высоты (крайний случай).
 * Выбранный — бегунок с акцентным оттенком и кромкой (тот же язык «выбрано», что у ChoiceChip).
 * Одна грамматика подписей для всех экранов:
 *  - `caption` — видимая подпись группы слева, обычным регистром («Стресс», «Ось графиков»);
 *  - `describe` — что делает выбранный вариант, видимой строкой под сегментом (`hint` варианта,
 *    иначе его `title`): жаргон «по факту»/«по часам» больше не прячется в подсказку наведения;
 *  - счётчик — тот же бейдж, что у вкладок (тише); глиф состояния — `status`, вне подписи (одна строка).
 * Совместимость: `kind="tab" | "nav"` и `PillTabs` рисуются как вкладки (Tabs) — навигация не похожа на режим.
 */
import {
  useCallback, useId, useLayoutEffect, useRef, useState,
  type CSSProperties, type KeyboardEvent, type ReactNode,
} from 'react'
import { Icon, type IconName } from '../../shell/icons'
import { Tabs, type TabItem } from './Tabs'
import { rovingNext } from './rovingKeys'
import './kit.css'

export interface SegOption<T extends string> {
  id: T
  label: ReactNode
  title?: string
  /** Что делает вариант — видимой строкой под сегментом при `describe` (иначе берётся `title`). */
  hint?: string
  /** Число в бейдже справа от подписи. */
  count?: number
  /** Пояснение числа для диктора: «200 записей». */
  countLabel?: string
  disabled?: boolean
  /** Причина недоступности — подсказка и текст для диктора. */
  reason?: string
  icon?: IconName
  /** Глиф состояния (▲ ■) — после подписи и счётчика, в той же строке; слово — в `title`. */
  status?: ReactNode
  /** Ссылка (только для `kind="nav"`): вкладки становятся ссылками. */
  href?: string
}

interface SegmentedProps<T extends string> {
  options: ReadonlyArray<SegOption<T>>
  value: T
  onChange: (id: T) => void
  /** Доступное имя группы (или видимая подпись через `labelledBy`). */
  label: string
  labelledBy?: string
  /** Видимая подпись группы слева, обычным регистром (12 px): «Стресс», «Финансирование». */
  caption?: string
  /** Показывать под сегментом, что делает выбранный вариант (`hint`, иначе `title`). */
  describe?: boolean
  /** @deprecated Навигацию рисуйте `Tabs`; здесь `tab`/`nav` превращаются во вкладки. */
  kind?: 'radio' | 'tab' | 'nav'
  /** sm 24 px — панели инструментов и фильтры; md 30 px — формы. `lg` = md (устарело). */
  size?: 'sm' | 'md' | 'lg'
  /** @deprecated Ширина всегда по содержимому. */
  fit?: boolean
  /** Равные колонки — только для ≤ 3 вариантов близкой длины. */
  equal?: boolean
  /** Префикс id для связи tab ↔ tabpanel (только `kind="tab"`). */
  idBase?: string
  /** Для `kind="tab"`: панели грузят данные → выбор по Enter/Space, а не стрелками. */
  activation?: 'auto' | 'manual'
  disabled?: boolean
  className?: string
}

/** Подпись варианта строкой — для выпадающего списка при нехватке ширины. */
const optionText = <T extends string>(o: SegOption<T>): string => {
  const base = typeof o.label === 'string' || typeof o.label === 'number' ? String(o.label) : (o.title ?? String(o.id))
  return o.count !== undefined ? `${base} (${o.count})` : base
}

export function Segmented<T extends string>(props: SegmentedProps<T>) {
  const { kind = 'radio' } = props
  if (kind === 'tab' || kind === 'nav') return <SegmentedAsTabs {...props} kind={kind} />
  return <SegmentedRadio {...props} />
}

function SegmentedAsTabs<T extends string>({ options, value, onChange, label, kind, size = 'md', idBase, activation, className }: SegmentedProps<T>) {
  const items: TabItem<T>[] = options.map((o) => ({
    id: o.id, label: o.label, icon: o.icon, count: o.count, countLabel: o.countLabel, title: o.title, disabled: o.disabled, reason: o.reason, href: o.href, status: o.status,
  }))
  return <Tabs items={items} value={value} onChange={onChange} label={label} size={size === 'sm' ? 'panel' : 'page'}
               kind={kind === 'nav' ? 'nav' : 'tablist'} idBase={idBase} activation={activation} className={className} />
}

/** Хозяин ширины: строка, в которой стоит сегмент (а не его собственная обёртка с подписью). */
const hostOf = (el: HTMLElement | null | undefined): HTMLElement | null => {
  const field = el?.closest<HTMLElement>('.dk-seg-field')
  return (field ?? el)?.parentElement ?? null
}

function SegmentedRadio<T extends string>({
  options, value, onChange, label, labelledBy, caption, describe = false, size = 'md', equal = false, disabled = false, className,
}: SegmentedProps<T>) {
  const uid = useId()
  const capId = `${uid}-cap`
  const hintId = `${uid}-hint`
  const rootRef = useRef<HTMLDivElement>(null)
  const btnRefs = useRef(new Map<T, HTMLButtonElement>())
  const [thumb, setThumb] = useState<{ l: number; w: number } | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const natural = useRef<{ need: number; parentAt: number } | null>(null)

  const measure = useCallback(() => {
    const root = rootRef.current
    if (!root) return
    // Не помещается (дорожка уже содержимого) → выпадающий список; запоминаем, сколько не хватило.
    if (root.scrollWidth > root.clientWidth + 1) {
      natural.current = { need: root.scrollWidth - root.clientWidth, parentAt: hostOf(root)?.clientWidth ?? 0 }
      setCollapsed(true)
      return
    }
    const btn = btnRefs.current.get(value)
    if (!btn) { setThumb(null); return }
    const l = btn.offsetLeft
    const w = btn.offsetWidth
    setThumb((prev) => (prev && prev.l === l && prev.w === w ? prev : { l, w }))
  }, [value])

  useLayoutEffect(() => {
    if (collapsed) return undefined
    measure()
    const root = rootRef.current
    if (!root || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(measure)
    ro.observe(root)
    return () => ro.disconnect()
  }, [measure, options, collapsed])

  // Свёрнутый: родитель вырос больше, чем не хватало, — пробуем снова дорожку.
  const selectRef = useRef<HTMLSelectElement>(null)
  useLayoutEffect(() => {
    const parent = hostOf(selectRef.current)
    if (!collapsed || !parent || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(() => {
      const n = natural.current
      if (n && parent.clientWidth > n.parentAt + n.need + 8) setCollapsed(false)
    })
    ro.observe(parent)
    return () => ro.disconnect()
  }, [collapsed])

  const sz = size === 'sm' ? 'sm' : 'md'
  const selected = options.find((o) => o.id === value)
  const hintText = describe ? selected?.hint ?? selected?.title : undefined
  const named = labelledBy ?? (caption ? capId : undefined)
  const a11y = { 'aria-label': named ? undefined : label, 'aria-labelledby': named, 'aria-describedby': hintText ? hintId : undefined }
  // Подпись слева и пояснение под сегментом — одна обёртка; без них разметка прежняя. Обёртка зависит
  // только от пропсов (не от выбранного варианта), иначе смена выбора пересоздала бы группу и сбросила фокус.
  const field = (control: ReactNode) => (caption || describe) ? (
    <div className={`dk-seg-field${caption ? ' dk-seg-field--cap' : ''}`}>
      {caption && <span className="dk-seg-cap" id={capId}>{caption}</span>}
      {control}
      {hintText && <span className="dk-seg-hint" id={hintId}>{hintText}</span>}
    </div>
  ) : control
  if (collapsed) {
    return field(
      <select ref={selectRef} className={`dk-seg-select dk-seg-select--${sz}${className ? ` ${className}` : ''}`} value={value}
              {...a11y} disabled={disabled} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => <option key={o.id} value={o.id} disabled={o.disabled}>{optionText(o)}</option>)}
      </select>,
    )
  }

  const enabled = options.filter((o) => !o.disabled)
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return
    const next = rovingNext(e.key, enabled.findIndex((o) => o.id === value), enabled.length)
    if (next < 0 || !enabled[next]) return
    e.preventDefault()
    onChange(enabled[next].id)
    btnRefs.current.get(enabled[next].id)?.focus()
  }

  const thumbStyle = thumb ? ({ '--l': `${thumb.l}px`, '--w': `${thumb.w}px` } as CSSProperties) : undefined
  const cls = ['dk-seg', `dk-seg--${sz}`, equal && options.length <= 3 ? 'dk-seg--equal' : '', className ?? ''].filter(Boolean).join(' ')
  return field(
    <div ref={rootRef} className={cls} role="radiogroup" {...a11y} aria-disabled={disabled || undefined} onKeyDown={onKeyDown}>
      {thumb && <span className="dk-seg__ind" style={thumbStyle} aria-hidden="true" />}
      {options.map((o) => {
        const on = o.id === value
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            data-seg={o.id}
            className={`dk-seg__opt${on ? ' is-on' : ''}`}
            disabled={disabled || o.disabled}
            title={o.disabled && o.reason ? o.reason : o.title}
            ref={(el) => { if (el) btnRefs.current.set(o.id, el); else btnRefs.current.delete(o.id) }}
            onClick={() => onChange(o.id)}
          >
            {o.icon && <Icon name={o.icon} size={14} />}
            <span className="dk-seg__label" data-label={typeof o.label === 'string' ? o.label : undefined}><span className="dk-seg__text">{o.label}</span></span>
            {o.count !== undefined && (
              <span className="dk-seg__count" title={o.countLabel}>
                <span aria-hidden={o.countLabel ? true : undefined}>{o.count}</span>
                {o.countLabel && <span className="dk-vh">, {o.countLabel}</span>}
              </span>
            )}
            {o.status && <span className="dk-seg__status">{o.status}</span>}
            {o.disabled && o.reason && <span className="dk-vh">, недоступно: {o.reason}</span>}
          </button>
        )
      })}
    </div>,
  )
}

export interface PillTab<T extends string> {
  id: T
  label: string
  icon?: IconName
  /** Короткая метка справа (счётчик и т. п.). */
  badge?: ReactNode
  href?: string
}

interface PillTabsProps<T extends string> {
  tabs: ReadonlyArray<PillTab<T>>
  value: T
  onChange: (id: T) => void
  ariaLabel: string
  idBase?: string
}

/** @deprecated Используйте `Tabs`. Разделы — вкладки с подчёркиванием (размер page). */
export function PillTabs<T extends string>({ tabs, value, onChange, ariaLabel, idBase }: PillTabsProps<T>) {
  const items: TabItem<T>[] = tabs.map((t) => ({ id: t.id, icon: t.icon, href: t.href, label: t.badge ? <>{t.label}{t.badge}</> : t.label }))
  return <Tabs items={items} value={value} onChange={onChange} label={ariaLabel} size="page" idBase={idBase} />
}
