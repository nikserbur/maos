/**
 * Петля агента [6] → [4] (UX-V2 §4.9, второй такт анимации §3.8): точки выходят из «Решений» [4]
 * в «Агенты» [6], там «перемешиваются» (пауза-облако) и возвращаются по пунктирной дуге `moves[]`.
 * `live` — политика опубликована или в последнем прогоне есть ходы: петля пульсирует;
 * `idle` — агент реализован, но политика гейт не прошла: тот же такт тускло и медленнее (честно —
 * показан механизм, не результат). При `prefers-reduced-motion` точки скрыты (CSS).
 */
import type { EdgePath } from './mapLayout'

export type LoopState = 'live' | 'idle'

const DOTS = 3
const STAGGER_S = 0.45

export function AgentLoop({ path, state }: { path: EdgePath; state: LoopState }) {
  const dur = state === 'live' ? 3.6 : 6
  return (
    <g className={`mm-loop mm-loop--${state}`} aria-hidden="true">
      <path className="mm-loop__glow" d={path.d} />
      {Array.from({ length: DOTS }, (_, i) => (
        <circle key={i} className="mm-loop__dot" r={state === 'live' ? 4 : 3}>
          {/* 4 → 6 (против ребра), пауза в [6], 6 → 4 (по ребру) */}
          <animateMotion dur={`${dur}s`} begin={`${i * STAGGER_S}s`} repeatCount="indefinite" path={path.d}
            keyPoints="1;0;0;1" keyTimes="0;0.4;0.6;1" calcMode="linear" />
        </circle>
      ))}
    </g>
  )
}
