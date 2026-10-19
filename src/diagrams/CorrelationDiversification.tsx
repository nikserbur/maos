/**
 * Корреляция → диверсификация. Для n равновзвешенных изделий с равными σ и
 * попарной корреляцией ρ: σ_P/σ = √(ρ + (1 − ρ)/n) → √ρ при n → ∞ (систематическая
 * часть не диверсифицируется). Корреляция цен в MAOS — однофакторная гауссова
 * копула z_s = β_s·M + √(1 − β_s²)·ε_s, corr(z_s, z_t) = β_s·β_t.
 */
import type { DiagramProps } from './types'
import { C, S1, S2, Frame, Label, gauss, lin, pathOf, rng, type Pt } from './primitives'

const NS = [1, 2, 5, 20] as const

function sigmaRatio(rho: number, n: number): number {
  return Math.sqrt(rho + (1 - rho) / n)
}

function curve(n: number, x: (v: number) => number, y: (v: number) => number): string {
  const pts: Pt[] = []
  for (let i = 0; i <= 50; i++) {
    const rho = i / 50
    pts.push([x(rho), y(n === Infinity ? Math.sqrt(rho) : sigmaRatio(rho, n))])
  }
  return pathOf(pts)
}

/** Мини-облака пар (z_s, z_t) при ρ = β² — «зерно» стохастики. */
function pairCloud(rho: number, cx: number, cy: number, s: number, seed: number): Pt[] {
  const r = rng(seed)
  const beta = Math.sqrt(rho)
  return Array.from({ length: 70 }, () => {
    const m = gauss(r)
    const a = beta * m + Math.sqrt(1 - rho) * gauss(r)
    const b = beta * m + Math.sqrt(1 - rho) * gauss(r)
    return [cx + s * Math.max(-2.4, Math.min(2.4, a)), cy - s * Math.max(-2.4, Math.min(2.4, b))] as const
  })
}

const CLOUD_LO = pairCloud(0.1, 476, 92, 13, 3)
const CLOUD_HI = pairCloud(0.9, 572, 92, 13, 3)

const TITLE = 'Корреляция цен ограничивает выгоду диверсификации'
const DESC =
  'Отношение σ портфеля к σ одного изделия в зависимости от корреляции ρ для n = 1, 2, 5, 20 изделий ' +
  'и предела n → ∞ (√ρ). При ρ → 1 все кривые сходятся к 1: в кризис диверсификация исчезает.'

export function CorrelationDiversification({ compact }: DiagramProps) {
  const g = compact
    ? { x0: 26, x1: 270, y0: 120, y1: 12, fs: 9.5 }
    : { x0: 58, x1: 392, y0: 262, y1: 36, fs: 11 }
  const x = lin(0, 1, g.x0, g.x1)
  const y = lin(0, 1.05, g.y0, g.y1)
  const shown = compact ? [1, 5] : NS
  const envelope = curve(Infinity, x, y)
  const band = `${envelope} L${x(1)},${y(1)} L${x(0)},${y(1)} Z`

  return (
    <Frame compact={compact} title={TITLE} desc={DESC}>
      {/* Диверсифицируемая часть риска: между n = 1 и n → ∞ — акцент */}
      <path d={band} fill={C.ok} fillOpacity={0.14} />
      <line x1={g.x0} y1={g.y0} x2={g.x1} y2={g.y0} stroke={C.line} />
      <line x1={g.x0} y1={g.y0} x2={g.x0} y2={g.y1} stroke={C.line} />
      {shown.map((n) => (
        <path key={n} d={curve(n, x, y)} fill="none" stroke={n === 1 ? C.ink : C.model}
          strokeWidth={n === 1 ? S1 : S1 + (n / 20) * 1.5} opacity={n === 1 ? 0.8 : 0.55 + n / 50} />
      ))}
      <path d={envelope} fill="none" stroke={C.model} strokeWidth={S2} strokeDasharray="6 3" />

      {shown.filter((n) => n > 1).map((n) => (
        <Label key={n} x={x(0) + 4} y={y(sigmaRatio(0, n)) - 3} size={g.fs - 1} color={C.ink}>{`n = ${n}`}</Label>
      ))}
      <Label x={x(0.02) + 2} y={y(1) - 4} size={g.fs - 1} color={C.ink}>n = 1</Label>
      <Label x={x(0.3)} y={y(Math.sqrt(0.3)) + (compact ? 10 : 14)} size={g.fs - 1} color={C.ink}>n → ∞: √ρ</Label>

      {compact ? (
        <g>
          <Label x={g.x1} y={g.y0 + 13} size={9.5} anchor="end">ρ →</Label>
          <Label x={g.x0 - 4} y={g.y1 + 6} size={9.5} anchor="end">{'σ_{P}'}</Label>
        </g>
      ) : (
        <g>
          {[0, 0.25, 0.5, 0.75, 1].map((t) => (
            <g key={t}>
              <line x1={x(t)} y1={g.y0} x2={x(t)} y2={g.y0 + 4} stroke={C.line} />
              <Label x={x(t)} y={g.y0 + 16} anchor="middle" size={10}>{t.toLocaleString('ru-RU')}</Label>
            </g>
          ))}
          {[0, 0.5, 1].map((t) => (
            <g key={t}>
              <line x1={g.x0 - 4} y1={y(t)} x2={g.x0} y2={y(t)} stroke={C.line} />
              <Label x={g.x0 - 8} y={y(t) + 3.5} anchor="end" size={10}>{t.toLocaleString('ru-RU')}</Label>
            </g>
          ))}
          <Label x={g.x1} y={g.y0 + 34} anchor="end" size={10.5}>корреляция цен ρ (market_corr)</Label>
          <Label x={g.x0 - 34} y={(g.y0 + g.y1) / 2} anchor="middle" size={10.5} rotate={-90}>{'σ_{P} / σ'}</Label>

          {/* Правая панель: зерно и формулы однофакторной модели */}
          {CLOUD_LO.map(([px, py], i) => <circle key={`a${i}`} cx={px} cy={py} r={1.5} fill={C.bone} />)}
          {CLOUD_HI.map(([px, py], i) => <circle key={`b${i}`} cx={px} cy={py} r={1.5} fill={C.bone} />)}
          <Label x={476} y={146} anchor="middle" size={10.5} color={C.ink}>ρ = 0,1</Label>
          <Label x={572} y={146} anchor="middle" size={10.5} color={C.ink}>ρ = 0,9 (кризис)</Label>
          <Label x={428} y={186} size={10.5} mono color={C.ink}>{'z_{s} = β_{s}·M + √(1−β_{s}²)·ε_{s}'}</Label>
          <Label x={428} y={206} size={10.5} mono color={C.ink}>{'corr(z_{s}, z_{t}) = β_{s}·β_{t}'}</Label>
          <Label x={428} y={226} size={10.5} mono color={C.ink}>{'σ_{P}² = σ²·(ρ + (1−ρ)/n)'}</Label>
          <Label x={428} y={250} size={10}>M — общий рыночный шок,</Label>
          <Label x={428} y={264} size={10}>ε — шок изделия; β по умолч. √ρ</Label>
          <rect x={428} y={278} width={18} height={10} fill={C.ok} fillOpacity={0.14} />
          <Label x={452} y={287} size={10}>диверсифицируемая часть риска</Label>
        </g>
      )}
    </Frame>
  )
}
