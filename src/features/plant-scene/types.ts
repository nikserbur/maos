/**
 * Доменные типы 3D-схемы предприятия.
 * Граф строится из реестров НСИ (machines + work_center_types + flows)
 * функцией buildGraphFromDb — статичного хардкода больше нет.
 */
import { STATUS_FALLBACK } from './themeColors'

export type ObjectKind =
  | 'feedstock'
  | 'cleaningarea'
  | 'dryer'
  | 'boiler'
  | 'finecleaning'
  | 'briquettes'
  | 'pileizer'
  | 'transformer'
  | 'wirehouse'
  | 'sale'
  | 'marketing'

export type StageStatus = 'running' | 'setup' | 'idle' | 'down'

export interface StageKpi {
  label: string
  value: string
}

export interface StatusMeta {
  label: string
  /** Токен цвета для DOM (`var(--status-*)`) — следует теме. */
  cssVar: string
  /** Класс глифа (● ▲ ○ ■) из glyphs.css: цвет никогда не единственный сигнал. */
  glyphClass: string
  /**
   * Статический sRGB-hex тёмной темы — только запасной вариант для кода без темы.
   * В WebGL/MapLibre брать `useThemeColors().status[...]` (см. themeColors.ts).
   */
  color: string
}

/** Статусы = токены `--status-*` + глифы; WebGL получает цвета через themeColors.ts. */
export const STATUS_META: Record<StageStatus, StatusMeta> = {
  running: { label: 'В работе', cssVar: 'var(--status-running)', glyphClass: 'glyph-running', color: STATUS_FALLBACK.running },
  setup: { label: 'Наладка', cssVar: 'var(--status-setup)', glyphClass: 'glyph-setup', color: STATUS_FALLBACK.setup },
  idle: { label: 'Простой', cssVar: 'var(--status-idle)', glyphClass: 'glyph-idle', color: STATUS_FALLBACK.idle },
  down: { label: 'Авария', cssVar: 'var(--status-down)', glyphClass: 'glyph-down', color: STATUS_FALLBACK.down },
}
