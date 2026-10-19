import type { ReactNode } from 'react'

/**
 * Линейные иконки MAOS (24×24, штрих 1.6, currentColor). Заменяют эмодзи в экранах:
 * 📊 chart · 💰 money · ⛓ link · 🔀 shuffle · 📈 trending · 💡 bulb · 📌 pin · ⚙ gear · ⛶ expand.
 * Использование: <Icon name="chart" size={16} />.
 */
const ICONS = {
  /* ── Навигация (экраны) ─────────────────────────────────────────────── */
  scheme: (
    <>
      <path d="M12 3 4 7v10l8 4 8-4V7z" />
      <path d="M4 7l8 4 8-4" />
      <path d="M12 21V11" />
    </>
  ),
  monitoring: <path d="M3 12h4l2 6 4-12 2 6h6" />,
  nsi: <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />,
  plan: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="1.5" />
      <path d="M3 9h18M8 4v3M16 4v3" />
    </>
  ),
  optimization: (
    <>
      <path d="M4 7h8M16 7h4M4 12h2M10 12h10M4 17h10M18 17h2" />
      <circle cx="14" cy="7" r="2" />
      <circle cx="8" cy="12" r="2" />
      <circle cx="16" cy="17" r="2" />
    </>
  ),
  scenarios: (
    <>
      <path d="M12 3 3 8l9 5 9-5z" />
      <path d="M3 13l9 5 9-5" />
    </>
  ),
  admin: <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />,
  analytics: (
    <>
      <path d="M3 3v18h18" />
      <rect x="7" y="12" width="3" height="6" />
      <rect x="12" y="8" width="3" height="10" />
      <rect x="17" y="5" width="3" height="13" />
    </>
  ),
  workflow: (
    <>
      <rect x="3" y="4" width="7" height="5" rx="1.2" />
      <rect x="14" y="15" width="7" height="5" rx="1.2" />
      <circle cx="18" cy="6.5" r="2.4" />
      <path d="M10 6.5h5.2M17.5 9v3.5M6.5 9v5.5l7.5 3" />
    </>
  ),
  /** Граф процесса: сырьё → операция → изделие. */
  graph: (
    <>
      <circle cx="5" cy="6" r="2.2" />
      <circle cx="5" cy="18" r="2.2" />
      <rect x="10" y="9.8" width="4.4" height="4.4" rx="0.8" />
      <path d="M19 9.5 21.5 14h-5z" />
      <path d="M7 7.2l3 3.4M7 16.8l3-3.4M14.4 12h2.4" />
    </>
  ),
  /** Методика. */
  book: (
    <>
      <path d="M4 5.5C4 4.7 4.7 4 5.5 4H11v16H5.5c-.8 0-1.5-.7-1.5-1.5z" />
      <path d="M20 5.5c0-.8-.7-1.5-1.5-1.5H13v16h5.5c.8 0 1.5-.7 1.5-1.5z" />
      <path d="M6.5 8h2.5M6.5 11h2.5M15 8h2.5M15 11h2.5" />
    </>
  ),
  /** ИИ / агенты. */
  sparkle: (
    <>
      <path d="M11 3.5c.5 3.8 2.2 5.5 6 6-3.8.5-5.5 2.2-6 6-.5-3.8-2.2-5.5-6-6 3.8-.5 5.5-2.2 6-6z" />
      <path d="M18.5 15.5c.2 1.6.9 2.3 2.5 2.5-1.6.2-2.3.9-2.5 2.5-.2-1.6-.9-2.3-2.5-2.5 1.6-.2 2.3-.9 2.5-2.5z" />
    </>
  ),
  factory: (
    <>
      <path d="M3 20V10l5 3V10l5 3V6h3l1 6h4v8z" />
      <path d="M3 20h18M7 17h2M12 17h2M17 17h1" />
    </>
  ),

  /* ── Данные и действия ──────────────────────────────────────────────── */
  chart: (
    <>
      <path d="M4 4v16h16" />
      <path d="M8 15l3.5-4 3 2.5L19 8" />
    </>
  ),
  money: (
    <>
      <rect x="3" y="6" width="18" height="12" rx="1.5" />
      <circle cx="12" cy="12" r="2.6" />
      <path d="M6.5 9.5v.01M17.5 14.5v.01" />
    </>
  ),
  link: (
    <>
      <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" />
    </>
  ),
  shuffle: (
    <>
      <path d="M3 7h3.5c4.5 0 6.5 10 11 10H21" />
      <path d="M3 17h3.5c1.6 0 2.8-1.2 3.8-2.8M13.7 9.8c1-1.6 2.2-2.8 3.8-2.8H21" />
      <path d="M18.5 4.5 21 7l-2.5 2.5M18.5 14.5 21 17l-2.5 2.5" />
    </>
  ),
  trending: (
    <>
      <path d="M3 17l6-6 4 4 8-8" />
      <path d="M15 7h6v6" />
    </>
  ),
  bulb: (
    <>
      <path d="M9 18h6M10 21h4" />
      <path d="M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.2h5c0-.9.4-1.7 1.1-2.2A6 6 0 0 0 12 3z" />
    </>
  ),
  pin: (
    <>
      <path d="M9 4h6l-1 5 3 3H7l3-3z" />
      <path d="M12 12v8" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" />
    </>
  ),
  expand: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5M12 7.5v.01" />
    </>
  ),
  play: <path d="M7 4.5v15l12-7.5z" />,
  pause: <path d="M8 5v14M16 5v14" />,
  flag: (
    <>
      <path d="M5 21V4" />
      <path d="M5 4h11l-2 4 2 4H5" />
    </>
  ),
  warning: (
    <>
      <path d="M12 3.5 22 20H2z" />
      <path d="M12 10v4.5M12 17v.01" />
    </>
  ),
  check: <path d="M4.5 12.5l5 5L19.5 7" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  plus: <path d="M12 5v14M5 12h14" />,
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="M15 15l5.5 5.5" />
    </>
  ),
  layers: (
    <>
      <path d="M12 3 2.5 8 12 13l9.5-5z" />
      <path d="M2.5 12.5 12 17.5l9.5-5M2.5 17 12 22l9.5-5" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="1.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4M7.5 14h2M11 14h2M14.5 14h2M7.5 17h2M11 17h2" />
    </>
  ),

  /* ── Оболочка ───────────────────────────────────────────────────────── */
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
    </>
  ),
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />,
} satisfies Record<string, ReactNode>

export type IconName = keyof typeof ICONS

/** Все доступные имена иконок. */
export const ICON_NAMES = Object.keys(ICONS) as IconName[]

const isIconName = (name: string): name is IconName => Object.prototype.hasOwnProperty.call(ICONS, name)

interface IconProps {
  /** Имя из ICON_NAMES (строка — для реестра экранов). */
  name: IconName | (string & {})
  size?: number
  strokeWidth?: number
  className?: string
}

export function Icon({ name, size = 20, strokeWidth = 1.6, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
      focusable="false"
    >
      {isIconName(name) ? ICONS[name] : null}
    </svg>
  )
}
