/**
 * Полоса времени симуляции внизу канваса (X2 P-29, P-39, P-40), 56 px: пуск/пауза (вторичная
 * контурная кнопка, без свечения), в начало, скорость, часы в календаре плана и ползунок.
 * Анимация на паузе (или «меньше движения») — время двигается только ползунком; «Пуск» явно
 * снимает паузу.
 */
import type { MutableRefObject } from 'react'
import { Icon } from '../../shell/icons'
import { useAnimationPaused } from '../../ui/motion'
import { num } from '../../explain/format'
import type { SimState } from './SimulationLayer'
import { fmtHorizon, fmtSimClock } from './simModel'
import type { SimSession } from './useSimSession'

export const SPEEDS = [1, 6, 24, 120, 720]   // модельных часов за секунду

interface SceneTimelineProps {
  sim: MutableRefObject<SimState>
  session: SimSession
}

export function SceneTimeline({ sim, session }: SceneTimelineProps) {
  const [paused, setPaused] = useAnimationPaused()
  const { meta, live } = session
  if (!meta?.planId) {
    return (
      <div className="scene__timeline scene__timeline--empty" role="status">
        {session.planError ? 'План для симуляции не загрузился — повторите в правой колонке.' : meta ? 'Построенного плана нет — постройте его в «Плане», чтобы проиграть на схеме.' : 'Загрузка плана…'}
      </div>
    )
  }
  const playing = live.playing && !paused
  const toggle = () => {
    const s = sim.current
    if (paused) { setPaused(false); s.playing = true; return }
    if (s.t >= s.makespan) s.t = 0
    s.playing = !s.playing
  }
  const rewind = () => { sim.current.t = 0; sim.current.playing = false }
  const label = playing ? 'Пауза' : paused ? 'Пуск (снимет паузу анимации)' : 'Пуск'
  return (
    <div className="scene__timeline" role="group" aria-label="Время симуляции">
      <button type="button" className="btn btn--icon scene__play" aria-label={label} title={label} aria-pressed={playing} onClick={toggle}>
        <Icon name={playing ? 'pause' : 'play'} size={16} />
      </button>
      <button type="button" className="btn btn--ghost btn--icon btn--sm" aria-label="В начало" title="В начало" onClick={rewind}>
        <Icon name="rewind" size={14} />
      </button>
      <select className="scene__speed" value={live.speed} aria-label="Скорость, модельных часов в секунду"
              onChange={(e) => { sim.current.speed = Number(e.target.value) }}>
        {SPEEDS.map((sp) => <option key={sp} value={sp}>×{num(sp, 0)} ч/с</option>)}
      </select>
      <div className="scene__clock">
        <span className="scene__clock-now num">{fmtSimClock(meta.startAt, live.t)}</span>
        <span className="scene__clock-span">горизонт {fmtHorizon(meta.makespan)}{paused ? ' · анимация на паузе — время ползунком' : ''}</span>
      </div>
      <input className="scene__scrub" type="range" min={0} max={Math.max(1, meta.makespan)} aria-label="Модельное время"
             aria-valuetext={fmtSimClock(meta.startAt, live.t)}
             step={meta.makespan / 500 || 1} value={live.t}
             onChange={(e) => { sim.current.t = Number(e.target.value); sim.current.playing = false }} />
    </div>
  )
}
