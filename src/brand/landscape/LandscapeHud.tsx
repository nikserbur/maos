/** HUD заставки: фазы поколения ГА, счётчики и кривая сходимости (DOM поверх WebGL). */

export const PHASES = ['Оценка', 'Отбор', 'Скрещивание', 'Мутация'] as const

export interface HudState {
  /** 0..3 — текущая фаза; PHASES.length — найден максимум. */
  phase: number
  gen: number
  best: number
  mean: number
  sigma: number
  history: ReadonlyArray<{ best: number; mean: number }>
  converged: boolean
}

const fmt = (v: number, d = 3) => v.toFixed(d).replace('.', ',')

function Convergence({ history }: { history: HudState['history'] }) {
  const W = 220
  const H = 56
  if (history.length < 2) return <svg className="ga-hud__chart" viewBox={`0 0 ${W} ${H}`} aria-hidden="true" />
  const n = Math.max(history.length - 1, 1)
  const x = (i: number) => (i / n) * W
  const y = (v: number) => H - 4 - Math.max(0, Math.min(1, v)) * (H - 8)
  const line = (k: 'best' | 'mean') => history.map((h, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(h[k]).toFixed(1)}`).join('')
  const area = `${line('best')}L${W},${H}L0,${H}Z`
  return (
    <svg className="ga-hud__chart" viewBox={`0 0 ${W} ${H}`} aria-label="Сходимость: лучшее и среднее значение по поколениям">
      <defs>
        <linearGradient id="ga-best-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--ochre)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="var(--ochre)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <line x1="0" x2={W} y1={y(1)} y2={y(1)} className="ga-hud__target" />
      <path d={area} fill="url(#ga-best-fill)" />
      <path d={line('mean')} className="ga-hud__mean" />
      <path d={line('best')} className="ga-hud__best" />
    </svg>
  )
}

export function LandscapeHud({ hud }: { hud: HudState }) {
  return (
    <div className="ga-hud">
      <div className="ga-hud__head">
        <span className="text-caps ga-hud__title">Генетический алгоритм</span>
        <span className="ga-hud__gen num">поколение {hud.gen}</span>
      </div>
      <ol className="ga-hud__phases" aria-label="Фаза поколения">
        {PHASES.map((p, i) => (
          <li key={p} className={i === hud.phase ? 'is-on' : i < hud.phase ? 'is-past' : ''}>{p}</li>
        ))}
      </ol>
      <div className="ga-hud__stats">
        <div><span className="text-caps">лучшее f</span><b className="num">{fmt(hud.best)}</b></div>
        <div><span className="text-caps">среднее f</span><b className="num">{fmt(hud.mean)}</b></div>
        <div><span className="text-caps">σ мутации</span><b className="num">{fmt(hud.sigma, 2)}</b></div>
      </div>
      <Convergence history={hud.history} />
      <p className={`ga-hud__status${hud.converged ? ' is-done' : ''}`}>
        {hud.converged ? '▲ Глобальный максимум найден — новый ландшафт' : 'Популяция исследует ландшафт…'}
      </p>
      <p className="ga-hud__caption">
        Иллюстрация: генетический алгоритм ищет глобальный максимум многоэкстремальной целевой функции —
        отбор, скрещивание, мутация. В MAOS ГА улучшает расписание (Стадия 1), портфель ищется
        робастной оптимизацией CVaR и точной LP-моделью.
      </p>
    </div>
  )
}
