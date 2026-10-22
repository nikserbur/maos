import { useId } from 'react'
import './brand.css'

/*
 * MAOS marks — geometry ported 1:1 from docs/research/A6-logo-{1,2,3,lockup}.svg
 * (viewBox 64 = 16 px at 4 units/px: strokes ≥ 4, gaps ≥ 2, smallest shape ≥ 10).
 * Mark 1 and the wordmark read theme tokens; marks 2 and 3 are self-grounded.
 */

interface MarkProps {
  /** Сторона в px (по умолчанию 24; CSS width/height могут переопределить). */
  size?: number
  /** Доступное имя; без него знак декоративный (aria-hidden). */
  title?: string
  className?: string
}

interface A11yAttrs {
  role?: 'img'
  'aria-label'?: string
  'aria-hidden'?: true
}

function a11y(title?: string): A11yAttrs {
  return title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': true }
}

const cx = (...parts: Array<string | false | undefined>): string => parts.filter(Boolean).join(' ')

/** Уникальный id для clipPath/gradient (useId даёт «:r0:» — двоеточия убираем). */
function useSvgId(prefix: string): string {
  return `${prefix}${useId().replace(/:/g, '')}`
}

/** Знак 1 «Триада»: ● система, ■ станки и материал, ▲ оптимизация, линия — поток. */
export function MarkTriad({ size = 24, title, className }: MarkProps) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={cx('mk mk1', className)} {...a11y(title)}>
      <circle className="mk1__u" cx="24" cy="40" r="18" />
      <line className="mk1__l" x1="8" y1="56" x2="48" y2="16" />
      <polygon className="mk1__o" points="52,3 62,30 42,30" />
      <rect className="mk1__r" x="44" y="42" width="16" height="16" />
    </svg>
  )
}

interface MarkCirclesProps extends MarkProps {
  /** Медленный дрейф кругов (отключается при prefers-reduced-motion). */
  drift?: boolean
}

/** Знак 2 «Несколько кругов»: завод ●, цех/план ●, зелёная линза — план встречает факт. */
export function MarkCircles({ size = 64, title, className, drift = false }: MarkCirclesProps) {
  const id = useSvgId('mk2')
  const plate = `${id}-plate`
  const clip = `${id}-clip`
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={cx('mk mk2', drift && 'mk2--drift', className)}
      {...a11y(title)}
    >
      <defs>
        <radialGradient id={plate} cx="0.42" cy="0.40" r="0.62">
          <stop className="mk2__p0" offset="0" />
          <stop className="mk2__p1" offset="0.78" />
          <stop className="mk2__p2" offset="1" />
        </radialGradient>
        <clipPath id={clip}>
          <circle cx="27" cy="36" r="16" />
        </clipPath>
      </defs>
      <circle cx="32" cy="32" r="30.5" fill={`url(#${plate})`} />
      <circle className="mk2__ring" cx="32" cy="32" r="30.5" />
      <circle className="mk2__u" cx="27" cy="36" r="16" />
      <g className="mk2__orbit">
        <circle className="mk2__o" cx="40" cy="25" r="11" />
      </g>
      {/* Клип на неподвижной группе: линза движется вместе с охрой, граница — с синим. */}
      <g clipPath={`url(#${clip})`}>
        <g className="mk2__orbit">
          <circle className="mk2__lens" cx="40" cy="25" r="11" />
        </g>
      </g>
      <g className="mk2__event">
        <circle className="mk2__r" cx="47" cy="46" r="5" />
      </g>
      {/* «Тишина возможности» исчезает на малых размерах (правило 16 px). */}
      {size >= 24 && <circle className="mk2__b" cx="17" cy="18" r="2.75" />}
    </svg>
  )
}

/** Знак 3 «Терпкий»: плитка охры, диск, повёрнутый ■ (−12°), драматическая диагональ. */
export function MarkTart({ size = 24, title, className }: MarkProps) {
  const clip = `${useSvgId('mk3')}-disc`
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={cx('mk mk3', className)} {...a11y(title)}>
      <defs>
        <clipPath id={clip}>
          <circle cx="22" cy="43" r="14" />
        </clipPath>
      </defs>
      <rect className="mk3__plate" x="0" y="0" width="64" height="64" rx="5" />
      <circle className="mk3__disc" cx="22" cy="43" r="14" />
      <rect className="mk3__sq" x="28" y="12" width="24" height="24" transform="rotate(-12 40 24)" />
      <g clipPath={`url(#${clip})`}>
        <rect className="mk3__lens" x="28" y="12" width="24" height="24" transform="rotate(-12 40 24)" />
      </g>
      <line className="mk3__line" x1="7" y1="7" x2="28.6" y2="28.6" />
      <circle className="mk3__pt" cx="45.5" cy="20.5" r="3.5" />
    </svg>
  )
}

/** Глифы словесного знака P E S C A D I T O (кегль 28 ед., штрих 5, скос на стыках):
 *  A — Λ без перекладины, финальная O — ультрамариновый диск (как ● в прежнем MΛ●S).
 *  «Pescadito de oro» — золотая рыбка полковника Аурелиано Буэндиа: сделать, переплавить, сделать заново. */
function WordmarkGlyphs() {
  return (
    <>
      <path className="wm__t" d="M80 46 V20.5 H89 A6.5 6.5 0 0 1 89 33.5 H80" />
      <path className="wm__t" d="M120 20.5 H103 V46 H120 M103 33.25 H116" />
      <path className="wm__t" d="M137.23 23.38 A5.75 5.75 0 1 0 132.25 32 A5.75 5.75 0 1 1 127.27 40.63" />
      <path className="wm__t" d="M164.4 25.1 A11 11 0 1 0 164.4 41.4" />
      <polyline className="wm__t" points="175,46 186.5,20.5 198,46" />
      <path className="wm__t" d="M205 46 V20.5 H211 A12.75 12.75 0 0 1 211 46 H205" />
      <line className="wm__t" x1="233.5" y1="20.5" x2="233.5" y2="46" />
      <path className="wm__t" d="M243 20.5 H261 M252 20.5 V46" />
      <circle className="wm__o" cx="282" cy="32" r="14" />
    </>
  )
}

interface WordmarkProps {
  /** Высота прописной в px (ширина ≈ 7.8 × height). */
  height?: number
  title?: string
  className?: string
}

/** Словесный знак «PESCADIT●» без шрифта — из примитивов Кандинского. */
export function Wordmark({ height = 14, title, className }: WordmarkProps) {
  return (
    <svg
      viewBox="80 18 218 28"
      height={height}
      width={(height * 218) / 28}
      className={cx('mk wm', className)}
      {...a11y(title)}
    >
      <WordmarkGlyphs />
    </svg>
  )
}

/** Локап: знак 1 «Триада» (круг-тело, треугольник-хвост, линия-удочка — рыбка) + словесный знак PESCADITO (304 × 64). */
export function Lockup({ height = 28, title = 'PESCADITO', className }: WordmarkProps) {
  return (
    <svg
      viewBox="0 0 304 64"
      height={height}
      width={(height * 304) / 64}
      className={cx('mk mk1 lockup', className)}
      {...a11y(title)}
    >
      <circle className="mk1__u" cx="24" cy="40" r="18" />
      <line className="mk1__l" x1="8" y1="56" x2="48" y2="16" />
      <polygon className="mk1__o" points="52,3 62,30 42,30" />
      <rect className="mk1__r" x="44" y="42" width="16" height="16" />
      <WordmarkGlyphs />
    </svg>
  )
}
