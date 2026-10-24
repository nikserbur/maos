/**
 * Петля агента [6] → [4] (UX-V2 §4.9, X2 P-131): `live` — политика опубликована или в последнем
 * плане есть ходы: точки выходят из «Решений» [4] в «Агенты» [6] и возвращаются по ребру `moves[]`
 * (есть пауза — AnimationToggle в шапке карты, и prefers-reduced-motion). `idle` — политика не
 * опубликована: статичный пунктир без точек и свечения — механизм показан, но не работает.
 */
import type { EdgePath } from './mapLayout'

export type LoopState = 'live' | 'idle'

const DOTS = 3
const STAGGER_S = 0.45
const LIVE_DUR_S = 3.6

/** Подпись состояния петли — для легенды и подсказки. */
export const LOOP_LABEL: Readonly<Record<LoopState, string>> = {
  live: 'петля [6] → [4]: ходы агента в плане',
  idle: 'петля не активна: политика не опубликована',
}

export function AgentLoop({ path, state, paused = false }: { path: EdgePath; state: LoopState; paused?: boolean }) {
  if (state === 'idle') {
    return (
      <g className="mm-loop mm-loop--idle" aria-hidden="true">
        <title>{LOOP_LABEL.idle}</title>
        <path className="mm-loop__idle" d={path.d} />
      </g>
    )
  }
  return (
    <g className={`mm-loop mm-loop--live${paused ? ' is-paused' : ''}`} aria-hidden="true">
      <title>{LOOP_LABEL.live}</title>
      <path className="mm-loop__glow" d={path.d} />
      {!paused && Array.from({ length: DOTS }, (_, i) => (
        <circle key={i} className="mm-loop__dot" r={4}>
          {/* 4 → 6 (против ребра), пауза в [6], 6 → 4 (по ребру) */}
          <animateMotion dur={`${LIVE_DUR_S}s`} begin={`${i * STAGGER_S}s`} repeatCount="indefinite" path={path.d}
            keyPoints="1;0;0;1" keyTimes="0;0.4;0.6;1" calcMode="linear" />
        </circle>
      ))}
    </g>
  )
}
