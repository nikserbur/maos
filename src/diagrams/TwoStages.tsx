/**
 * D1 «Две стадии» (A6 §6): облако сценариев цен → ▲ Стадия 2 (робастный
 * портфель, что выпускать) → ● Стадия 1 (расписание, как выпускать) с «кометами»
 * тяжёлых хвостов; пунктирная обратная связь — калибровка себестоимости/сроков.
 * Это иерархическая двухуровневая модель, а не двухэтапная задача с рекурсом.
 */
import type { DiagramProps } from './types'
import {
  C, S1, S2, Arrow, CurveArrow, Frame, Label, gauss, grainInTriangle, rng, triPoints, type Pt,
} from './primitives'

/** Облако коррелированных сценариев (ρ ≈ 0.6): вытянуто по «гармонической» диагонали. */
function cloud(cx: number, cy: number, spread: number, n: number, seed: number): Pt[] {
  const r = rng(seed)
  const rho = 0.6
  const out: Pt[] = []
  while (out.length < n) {
    const a = gauss(r)
    const b = rho * a + Math.sqrt(1 - rho * rho) * gauss(r)
    if (Math.abs(a) > 2.3 || Math.abs(b) > 2.3) continue
    out.push([cx + spread * a, cy - spread * b])
  }
  return out
}

interface Lane { y: number; bars: Array<[number, number, boolean]> }

/** Мини-Гант внутри ●: [начало, длина, хвост?] в долях полосы. */
const LANES: Array<Lane['bars']> = [
  [[0.02, 0.22, false], [0.3, 0.28, true], [0.72, 0.18, false]],
  [[0.0, 0.34, false], [0.4, 0.2, false], [0.66, 0.22, false]],
  [[0.08, 0.18, false], [0.32, 0.3, false], [0.7, 0.14, true]],
  [[0.04, 0.26, true], [0.46, 0.2, false], [0.72, 0.2, false]],
]

const CLOUD_FULL = cloud(96, 176, 28, 72, 11)
const CLOUD_COMPACT = cloud(40, 82, 12, 34, 11)
const GRAIN_FULL = grainInTriangle(316, 91, 120, 110, 46, 5)
const GRAIN_COMPACT = grainInTriangle(128, 39, 56, 50, 18, 5)

function Gantt({ x0, x1, lanes, sq, barH }: { x0: number; x1: number; lanes: number[]; sq: number; barH: number }) {
  const w = x1 - x0 - sq - 4
  return (
    <g>
      {lanes.map((y, li) => (
        <g key={li}>
          <rect x={x0} y={y - sq / 2} width={sq} height={sq} fill="none" stroke={C.ink} strokeWidth={1.2} />
          {LANES[li % LANES.length].map(([s, len, tail], bi) => {
            const bx = x0 + sq + 4 + s * w
            const bw = len * w
            return (
              <g key={bi}>
                <rect x={bx} y={y - barH / 2} width={bw} height={barH} fill={C.model} opacity={0.85} />
                {tail && (
                  <polygon
                    points={`${bx + bw},${y - barH / 2} ${bx + bw + w * 0.16},${y} ${bx + bw},${y + barH / 2}`}
                    fill={C.risk} opacity={0.75} className="dg-breathe"
                  />
                )}
              </g>
            )
          })}
        </g>
      ))}
    </g>
  )
}

const TITLE = 'Иерархическая двухуровневая модель: Стадия 2 → Стадия 1'
const DESC =
  'Облако сценариев цен через метод Монте-Карло питает Стадию 2 — робастный портфель (что выпускать). ' +
  'Портфель передаётся в Стадию 1 — расписание (как выпускать) с тяжелохвостными длительностями. ' +
  'Пунктирная обратная связь от Стадии 1 калибрует себестоимость и сроки Стадии 2.'

export function TwoStages({ compact }: DiagramProps) {
  if (compact) {
    return (
      <Frame compact title={TITLE} desc={DESC}>
        {CLOUD_COMPACT.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={1.3} fill={C.bone} />)}
        <Arrow x1={62} y1={64} x2={108} y2={46} dashed color={C.muted} head={5} />
        <polygon points={triPoints(128, 39, 56, 50)} fill={C.goal} />
        {GRAIN_COMPACT.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={0.8} fill={C.ground} opacity={0.6} />)}
        <circle cx={222} cy={80} r={44} fill={C.model} fillOpacity={0.08} stroke={C.model} strokeWidth={S2} />
        <Gantt x0={194} x1={252} lanes={[66, 80, 94]} sq={5} barH={3} />
        <Arrow x1={150} y1={50} x2={184} y2={60} width={S1} head={5} />
        <CurveArrow from={[180, 98]} ctrl={[148, 118]} to={[134, 68]} dashed color={C.muted} head={5} />
        <Label x={162} y={20} size={10} color={C.ink} weight={600}>Стадия 2 · что</Label>
        <Label x={222} y={136} size={10} anchor="middle" color={C.ink} weight={600}>Стадия 1 · как</Label>
        <Label x={40} y={136} size={10} anchor="middle">сценарии</Label>
      </Frame>
    )
  }
  return (
    <Frame title={TITLE} desc={DESC}>
      {/* Сценарии: облако коррелированных цен */}
      {CLOUD_FULL.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={1.8} fill={C.bone} />)}
      <Label x={96} y={274} anchor="middle" size={12} color={C.ink} weight={600}>Сценарий</Label>
      <Label x={96} y={289} anchor="middle">распределения цен π</Label>
      <Label x={96} y={303} anchor="middle" size={10} mono>price_distributions</Label>

      <Arrow x1={144} y1={138} x2={270} y2={112} dashed color={C.muted} flow />
      <Label x={202} y={116} anchor="middle" size={10.5} rotate={-11.7}>Монте-Карло · N прогонов</Label>

      {/* Стадия 2: ▲ с зерном */}
      <polygon points={triPoints(316, 91, 120, 110)} fill={C.goal} />
      {GRAIN_FULL.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={1.1} fill={C.ground} opacity={0.55} />)}
      <Label x={394} y={34} size={12} color={C.ink} weight={600}>Стадия 2 — робастный портфель x</Label>
      <Label x={394} y={50}>{'что выпускать · max CVaR_{α}(прибыль)'}</Label>
      <Label x={394} y={64} size={10} mono>POST /api/optimize</Label>

      {/* ▲ → ●: программа выпуска (сплошная) */}
      <Arrow x1={364} y1={112} x2={432} y2={124} width={S1} />
      <Label x={366} y={98} size={9.5} mono>portfolio_items</Label>

      {/* Стадия 1: ● с мини-Гантом и «кометами» хвостов */}
      <circle cx={510} cy={182} r={96} fill={C.model} fillOpacity={0.07} stroke={C.model} strokeWidth={S2} />
      <Gantt x0={438} x1={586} lanes={[146, 170, 194, 218]} sq={8} barH={5} />
      <Label x={510} y={296} anchor="middle" size={12} color={C.ink} weight={600}>Стадия 1 — расписание</Label>
      <Label x={510} y={311} anchor="middle">как выпускать · хвосты длительностей</Label>

      {/* ● → ▲: обратная связь (пунктир) */}
      <CurveArrow from={[416, 202]} ctrl={[352, 236]} to={[330, 152]} dashed color={C.muted} flow />
      <Label x={300} y={236} anchor="middle" size={10.5}>калибровка себестоимости / сроков</Label>
      <Label x={300} y={250} anchor="middle" size={10} mono>stage1_feedback</Label>
    </Frame>
  )
}
