/**
 * Легенда статусов схемы — в языке глифов (● ▲ ○ ■): цвет никогда не единственный сигнал,
 * токены темы вместо статических hex.
 */
import { STATUS_META } from './types'

export function SceneLegend() {
  return (
    <div className="legend" aria-hidden="true">
      <div className="legend__title text-caps">Статус</div>
      {Object.values(STATUS_META).map((meta) => (
        <div className={`legend__row ${meta.glyphClass}`} key={meta.label}>{meta.label}</div>
      ))}
    </div>
  )
}
