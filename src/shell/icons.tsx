import type { ReactNode } from 'react'

/** Минимальный набор линейных иконок для рельсы навигации. */
const ICONS: Record<string, ReactNode> = {
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
}

interface IconProps {
  name: string
  size?: number
}

export function Icon({ name, size = 20 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {ICONS[name]}
    </svg>
  )
}
