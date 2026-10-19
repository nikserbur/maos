/**
 * Транспортные партии (lot streaming): партия q = 4 ед. на двух станках
 * (p₁ = 2 ч/ед., p₂ = 1,5 ч/ед.). Целиком: C = q(p₁+p₂) = 14 ч; N = 4 равных
 * подпартии: C = (q/N)(p₁+p₂) + (N−1)(q/N)·max(p₁,p₂) = 9,5 ч.
 * Третья панель — правило B1: подпартия-потребитель k ждёт ПОСЛЕДНЮЮ нужную
 * подпартию входа j*(k) = ⌈(k+1)·L/N⌉ − 1, а не первую.
 */
import type { DiagramProps } from './types'
import { C, S1, Arrow, Bracket, Frame, Label, fmt, lin } from './primitives'

type Bar = readonly [start: number, end: number]

const Q = 4
const P1 = 2
const P2 = 1.5
const SEQ: { m1: Bar[]; m2: Bar[] } = { m1: [[0, Q * P1]], m2: [[Q * P1, Q * (P1 + P2)]] }
const STREAM = (() => {
  const m1: Bar[] = []
  const m2: Bar[] = []
  let free2 = 0
  for (let k = 0; k < Q; k++) {
    const e1 = (k + 1) * P1
    m1.push([k * P1, e1])
    const s2 = Math.max(e1, free2)
    free2 = s2 + P2
    m2.push([s2, free2])
  }
  return { m1, m2 }
})()
const C_SEQ = Q * (P1 + P2)
const C_LS = STREAM.m2[Q - 1][1]

/** Панель B1: L = 4 подпартии входа по 1 ед., N = 2 подпартии потребителя по 2 ед. */
const L_IN = 4
const N_CONS = 2
const lastNeeded = (k: number) => Math.ceil(((k + 1) * L_IN) / N_CONS) - 1
const CONS: Bar[] = (() => {
  const out: Bar[] = []
  let free = 0
  for (let k = 0; k < N_CONS; k++) {
    const ready = STREAM.m1[lastNeeded(k)][1]
    const s = Math.max(ready, free)
    free = s + (Q / N_CONS) * P2
    out.push([s, free])
  }
  return out
})()

interface RowProps { bars: Bar[]; y: number; h: number; x: (t: number) => number; fill: string; opacity: number }

function Row({ bars, y, h, x, fill, opacity }: RowProps) {
  return (
    <g>
      {bars.map(([s, e], i) => (
        <rect key={i} x={x(s) + 0.5} y={y} width={x(e) - x(s) - 1} height={h} fill={fill} opacity={opacity} />
      ))}
    </g>
  )
}

const TITLE = 'Транспортные партии: перекрытие операций сокращает цикл'
const DESC =
  `Партия из ${Q} единиц на двух станках: при передаче целиком цикл ${fmt(C_SEQ)} ч, ` +
  `при ${Q} транспортных партиях — ${fmt(C_LS)} ч. При разных размерах партий подпартия-потребитель ждёт ` +
  'последнюю нужную ей подпартию входа.'

export function LotStreaming({ compact }: DiagramProps) {
  if (compact) {
    const x = lin(0, 14, 70, 268)
    return (
      <Frame compact title={TITLE} desc={DESC}>
        <Label x={64} y={33} size={9.5} anchor="end" color={C.ink}>целиком</Label>
        <Row bars={SEQ.m1} y={16} h={9} x={x} fill={C.model} opacity={0.8} />
        <Row bars={SEQ.m2} y={28} h={9} x={x} fill={C.bone} opacity={0.6} />
        <Label x={64} y={83} size={9.5} anchor="end" color={C.ink}>N = 4</Label>
        <Row bars={STREAM.m1} y={66} h={9} x={x} fill={C.model} opacity={0.8} />
        <Row bars={STREAM.m2} y={78} h={9} x={x} fill={C.bone} opacity={0.6} />
        <rect x={x(C_LS)} y={62} width={x(C_SEQ) - x(C_LS)} height={30} fill={C.ok} fillOpacity={0.18} />
        <Bracket x1={x(C_LS)} x2={x(C_SEQ)} y={102} up />
        <Label x={(x(C_LS) + x(C_SEQ)) / 2} y={116} size={9.5} anchor="middle" color={C.ink}>{`−${fmt(C_SEQ - C_LS)} ч`}</Label>
        <line x1={70} y1={130} x2={268} y2={130} stroke={C.line} />
        <Label x={268} y={126} size={9} anchor="end">время →</Label>
      </Frame>
    )
  }
  const x = lin(0, 14, 128, 600)
  const h = 12
  return (
    <Frame title={TITLE} desc={DESC}>
      {/* A: целиком */}
      <Label x={16} y={20} size={11} color={C.ink} weight={600}>{`Партия передаётся целиком: C = q(p₁+p₂) = ${fmt(C_SEQ)} ч`}</Label>
      <Label x={118} y={41} size={10.5} anchor="end">М1 · оп. 1</Label>
      <Label x={118} y={59} size={10.5} anchor="end">М2 · оп. 2</Label>
      <Row bars={SEQ.m1} y={31} h={h} x={x} fill={C.model} opacity={0.8} />
      <Row bars={SEQ.m2} y={49} h={h} x={x} fill={C.bone} opacity={0.6} />
      <Arrow x1={x(8)} y1={43} x2={x(8)} y2={49} head={5} />

      {/* B: транспортные партии */}
      <Label x={16} y={92} size={11} color={C.ink} weight={600}>{`Транспортные партии N = ${Q}: C = ${fmt(C_LS)} ч`}</Label>
      <Label x={118} y={113} size={10.5} anchor="end">М1 · оп. 1</Label>
      <Label x={118} y={131} size={10.5} anchor="end">М2 · оп. 2</Label>
      <rect x={x(C_LS)} y={99} width={x(C_SEQ) - x(C_LS)} height={36} fill={C.ok} fillOpacity={0.16} />
      <Row bars={STREAM.m1} y={103} h={h} x={x} fill={C.model} opacity={0.8} />
      <Row bars={STREAM.m2} y={121} h={h} x={x} fill={C.bone} opacity={0.6} />
      {STREAM.m1.map(([, e], k) => <Arrow key={k} x1={x(e)} y1={115} x2={x(STREAM.m2[k][0]) + 1} y2={121} head={5} width={1.2} />)}
      <Bracket x1={x(C_LS)} x2={x(C_SEQ)} y={140} up={false} />
      <Label x={(x(C_LS) + x(C_SEQ)) / 2} y={156} size={10.5} anchor="middle" color={C.ink}>{`выигрыш ${fmt(C_SEQ - C_LS)} ч`}</Label>

      {/* C: правило B1 */}
      <Label x={16} y={178} size={11} color={C.ink} weight={600}>{`Разные партии: L = ${L_IN} входа → N = ${N_CONS} потребителя`}</Label>
      <Label x={118} y={199} size={10.5} anchor="end">вход (оп. A)</Label>
      <Label x={118} y={217} size={10.5} anchor="end">потребитель</Label>
      <Row bars={STREAM.m1} y={189} h={h} x={x} fill={C.model} opacity={0.8} />
      <Row bars={CONS} y={207} h={h} x={x} fill={C.bone} opacity={0.6} />
      {CONS.map(([s], k) => (
        <Arrow key={k} x1={x(STREAM.m1[lastNeeded(k)][1])} y1={201} x2={x(s) + 1} y2={207} head={5} width={1.2} />
      ))}
      {/* Ошибочная стыковка (до исправления B1): старт сразу после ПЕРВОЙ подпартии */}
      <rect x={x(2) + 0.5} y={225} width={x(5) - x(2) - 1} height={h - 2} fill="none" stroke={C.risk} strokeWidth={S1} strokeDasharray="3 2" />
      <Arrow x1={x(2)} y1={201} x2={x(2)} y2={225} color={C.risk} dashed head={5} width={1.2} />
      <Label x={x(5) + 6} y={234} size={10} color={C.ink}>× ошибка B1: старт до готовности входа</Label>
      <Label x={x(14)} y={178} size={10.5} mono anchor="end" color={C.ink}>{'j*(k) = ⌈(k+1)·L/N⌉ − 1'}</Label>

      {/* Ось времени */}
      <line x1={x(0)} y1={252} x2={x(14)} y2={252} stroke={C.line} />
      {[0, 2, 4, 6, 8, 10, 12, 14].map((t) => (
        <g key={t}>
          <line x1={x(t)} y1={252} x2={x(t)} y2={256} stroke={C.line} />
          <Label x={x(t)} y={267} size={10} anchor="middle">{String(t)}</Label>
        </g>
      ))}
      <Label x={x(14)} y={282} size={10.5} anchor="end">время, ч</Label>
      <Label x={16} y={300} size={10} mono>{'C_{ls} = (q/N)(p_{1}+p_{2}) + (N−1)(q/N)·max(p_{1}, p_{2})'}</Label>
    </Frame>
  )
}
