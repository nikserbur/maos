/*
 * Атмосферный слой (A6 §4): aurora + зерно. Стили — src/styles/atmosphere.css.
 *  - login — анимированная aurora (только transform) + «плёночное» зерно 6 %, на весь экран;
 *  - shell — статичный оттенок + зерно 3 % внутри хрома (верхняя панель);
 *  - empty — статичная aurora + зерно 4 % внутри пустого состояния (контейнер с position).
 * Никогда не кладите его под таблицы, Гант, KPI, формы, 3D-холст или карту.
 */

export type BackdropVariant = 'login' | 'shell' | 'empty'

interface BackdropProps {
  variant: BackdropVariant
  /** Остановить анимацию (например, пока видна 3D-сцена или карта). */
  paused?: boolean
  className?: string
}

export function Backdrop({ variant, paused = false, className }: BackdropProps) {
  const pausedAttr = paused ? '' : undefined
  const rootClass = `backdrop backdrop--${variant}${className ? ` ${className}` : ''}`
  return (
    <div className={rootClass} aria-hidden="true" data-paused={pausedAttr}>
      {variant !== 'shell' && (
        <div className={variant === 'empty' ? 'aurora aurora--static' : 'aurora'} data-paused={pausedAttr}>
          <i />
          <i />
          <i />
        </div>
      )}
      <div className={variant === 'login' ? 'backdrop__grain grain grain--film' : 'backdrop__grain grain'} />
    </div>
  )
}
