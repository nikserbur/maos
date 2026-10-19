/**
 * Агентный слой (A4 §2): L2 — планировщик завода (трансфертные цены π_w, бонусы b_k),
 * L1 — начальники цехов (правило/веса, лимит НЗП), L0 — диспетчеры станков с общей
 * политикой θ_w на тип РЦ и пулом состояния μ_w. Среда — дискретно-событийный
 * симулятор; материальный баланс — маски допустимых действий; общий шум z_t — для всех.
 */
import type { DiagramProps } from './types'
import { C, S1, S2, Arrow, Frame, Label, rng, triPoints } from './primitives'

/** Число станков каждого типа РЦ в каждом из трёх цехов. */
const SHOPS: ReadonlyArray<readonly number[]> = [[3, 2], [2, 3], [4]]
const EVENTS: number[] = (() => { const r = rng(31); return Array.from({ length: 26 }, () => r()).sort((a, b) => a - b) })()
const NOISE: Array<readonly [number, number]> = (() => { const r = rng(8); return Array.from({ length: 34 }, () => [r(), r()] as const) })()

const LEVELS = [
  { key: 'yL2', code: 'L2', name: 'планировщик завода', sub: 'цены π_{w} ≥ 0, бонусы b_{k} · период' },
  { key: 'yL1', code: 'L1', name: 'начальники цехов', sub: 'правило, веса, лимит НЗП · смена' },
  { key: 'yL0', code: 'L0', name: 'диспетчеры станков', sub: 'общая θ_{w} на тип РЦ, пул μ_{w} · событие' },
  { key: 'yEnv', code: 'env', name: 'SimEnv', sub: 'дискретно-событийный симулятор' },
] as const

interface Geo { lx: number; ax0: number; ax1: number; yL2: number; yL1: number; yL0: number; yEnv: number; fs: number; noiseX: number; noiseW: number; sq: number; m: number; gap: number }
const G_FULL: Geo = { lx: 16, ax0: 240, ax1: 566, yL2: 40, yL1: 112, yL0: 186, yEnv: 262, fs: 11, noiseX: 584, noiseW: 40, sq: 22, m: 9, gap: 10 }
const G_COMPACT: Geo = { lx: 6, ax0: 48, ax1: 246, yL2: 18, yL1: 50, yL0: 82, yEnv: 118, fs: 9.5, noiseX: 254, noiseW: 18, sq: 12, m: 5, gap: 6 }

interface Group { x0: number; w: number; k: number }

/** Раскладка групп станков (по типам РЦ) под цехом: префиксные суммы ширин. */
function groupsOf(shop: readonly number[], cx: number, g: Geo): Group[] {
  const widths = shop.map((k) => k * (g.m + 3) - 3)
  const total = widths.reduce((s, w) => s + w + 6 + g.gap, -g.gap)
  return shop.map((k, i) => ({
    k,
    w: widths[i],
    x0: cx - total / 2 + 3 + widths.slice(0, i).reduce((s, w) => s + w + 6 + g.gap, 0),
  }))
}

const TITLE = 'Агентный слой: планировщик → цеха → диспетчеры станков → симулятор'
const DESC =
  'Три уровня агентов над дискретно-событийным симулятором: планировщик завода задаёт трансфертные цены машино-часа ' +
  'и бонусы заказов, начальники цехов — правила и лимиты, диспетчеры станков с общей политикой на тип РЦ выбирают ' +
  'операцию или ожидание. Маски действий обеспечивают материальный баланс, общий шум действует на все уровни.'

export function AgentLayers({ compact }: DiagramProps) {
  const g = compact ? G_COMPACT : G_FULL
  const shopX = (i: number) => g.ax0 + ((i + 0.5) * (g.ax1 - g.ax0)) / SHOPS.length
  const midX = (g.ax0 + g.ax1) / 2
  const head = compact ? 4 : 6
  const obsX = g.ax1 - (compact ? 4 : 10)

  return (
    <Frame compact={compact} title={TITLE} desc={DESC}>
      {/* Общий шум z_t — зерно киновари справа, действует на все уровни */}
      {NOISE.map(([a, b], i) => (
        <circle key={i} cx={g.noiseX + a * g.noiseW} cy={g.yL2 - 10 + b * (g.yEnv - g.yL2 + 20)} r={compact ? 1 : 1.6} fill={C.risk} opacity={0.7} />
      ))}

      {/* L2: планировщик ▲ → цены и бонусы цехам */}
      <polygon points={triPoints(midX, g.yL2, compact ? 16 : 30, compact ? 16 : 30)} fill={C.goal} />
      {SHOPS.map((shop, si) => (
        <g key={si}>
          <Arrow x1={midX} y1={g.yL2 + (compact ? 9 : 16)} x2={shopX(si)} y2={g.yL1 - g.sq / 2 - 2} dashed color={C.model} head={head} flow />
          <rect x={shopX(si) - g.sq / 2} y={g.yL1 - g.sq / 2} width={g.sq} height={g.sq} fill={C.ground} stroke={C.ink} strokeWidth={S1} />
          {groupsOf(shop, shopX(si), g).map((gr, ti) => (
            <g key={ti}>
              <Arrow x1={shopX(si)} y1={g.yL1 + g.sq / 2 + 1} x2={gr.x0 + gr.w / 2} y2={g.yL0 - g.m / 2 - 6} dashed color={C.model} head={head - 1} />
              <rect x={gr.x0 - 3} y={g.yL0 - g.m / 2 - 4} width={gr.w + 6} height={g.m + 8} rx={3} fill="none"
                stroke={C.model} strokeWidth={1} strokeDasharray="2 2" />
              {Array.from({ length: gr.k }, (_, j) => (
                <rect key={j} x={gr.x0 + j * (g.m + 3)} y={g.yL0 - g.m / 2} width={g.m} height={g.m} fill={C.ink} opacity={0.85} />
              ))}
              {/* Действие в среду через маску допустимых действий (ярь-медянка) */}
              <line x1={gr.x0 + gr.w / 2} y1={g.yL0 + g.m / 2 + 4} x2={gr.x0 + gr.w / 2} y2={g.yEnv - (compact ? 4 : 8)} stroke={C.ink} strokeWidth={1} />
              <rect x={gr.x0 + gr.w / 2 - (compact ? 5 : 8)} y={(g.yL0 + g.yEnv) / 2 - 1.5} width={compact ? 10 : 16} height={3} fill={C.ok} />
            </g>
          ))}
        </g>
      ))}

      {/* Среда: ● симулятор + шкала событий · */}
      <circle cx={g.ax0 - (compact ? 14 : 26)} cy={g.yEnv} r={compact ? 8 : 18} fill={C.model} />
      <line x1={g.ax0 - (compact ? 4 : 6)} y1={g.yEnv} x2={g.ax1} y2={g.yEnv} stroke={C.model} strokeWidth={S2} />
      {EVENTS.map((e, i) => (
        <circle key={i} cx={g.ax0 + e * (g.ax1 - g.ax0)} cy={g.yEnv} r={compact ? 1.6 : 2.4} fill={C.ground} stroke={C.ink} strokeWidth={0.8} />
      ))}

      {/* Наблюдения и награды — вверх, пунктир */}
      <Arrow x1={obsX} y1={g.yEnv - (compact ? 6 : 10)} x2={obsX} y2={g.yL2 + 6} dashed color={C.muted} head={head} />

      {LEVELS.map((l) => (
        <g key={l.code}>
          <Label x={g.lx} y={g[l.key] + (compact ? 3 : -2)} size={g.fs} mono color={C.ink} weight={600}>{l.code}</Label>
          {!compact && <Label x={g.lx + 34} y={g[l.key] - 2} size={11} color={C.ink} weight={600}>{l.name}</Label>}
          {!compact && <Label x={g.lx} y={g[l.key] + 13} size={9.5}>{l.sub}</Label>}
        </g>
      ))}
      {!compact && (
        <g>
          <Label x={midX + 22} y={g.yL2 + 4} size={10.5} mono color={C.ink}>{'max CVaR_{α}(прибыль)'}</Label>
          <Label x={obsX - 6} y={(g.yL2 + g.yEnv) / 2} size={10} anchor="middle" rotate={-90}>наблюдения, награды</Label>
          <rect x={g.lx} y={295} width={16} height={3} fill={C.ok} />
          <Label x={g.lx + 22} y={300} size={10}>маска: операция допустима, только если входы есть,</Label>
          <Label x={g.lx + 22} y={314} size={10}>{'предшественники готовы и рабочий свободен ⇒ I_{p}(t) ≥ 0'}</Label>
          <Label x={632} y={300} size={10.5} anchor="end" color={C.ink}>{'общий шум z_{t}'}</Label>
          <Label x={632} y={314} size={9.5} anchor="end">рынок, поставки, энергия</Label>
        </g>
      )}
    </Frame>
  )
}
