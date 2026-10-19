/**
 * D3 IDEF0 ICOM (A6 §6; FIPS PUB 183, Р 50.1.028-2001): блок-функция A0.
 * Управление (C) — сверху, пунктир ультрамарина (планы, нормы); вход (I) — слева,
 * выход (O) — справа, сплошные линии с острыми наконечниками; механизмы (M) —
 * снизу, ■ киновари (станки, рабочие). Номер узла — моноширинно в правом нижнем углу.
 */
import type { DiagramProps } from './types'
import { C, S1, S2, Arrow, Frame, Label } from './primitives'

const TITLE = 'IDEF0: функция A0 и стрелки ICOM'
const DESC =
  'Блок A0 «Изготовить изделие по маршрутной карте». Сверху входят управления (программа, сроки, техкарта, нормы, ' +
  'календарь), слева — входы (сырьё, полуфабрикаты), справа выходят изделие и данные о выполнении, снизу — механизмы ' +
  '(станки допустимого типа РЦ и рабочие нужной квалификации).'

function Chips({ x, y, n, size }: { x: number; y: number; n: number; size: number }) {
  return (
    <g>
      {Array.from({ length: n }, (_, i) => (
        <rect key={i} x={x + i * (size + 3)} y={y} width={size} height={size} fill={C.risk} />
      ))}
    </g>
  )
}

export function Idef0({ compact }: DiagramProps) {
  if (compact) {
    return (
      <Frame compact title={TITLE} desc={DESC}>
        <rect x={96} y={42} width={88} height={52} fill={C.ground} stroke={C.ink} strokeWidth={S1} />
        <Label x={140} y={72} size={10.5} anchor="middle" color={C.ink} weight={600}>Изготовить</Label>
        <Label x={180} y={90} size={9} anchor="end" mono>A0</Label>
        <Arrow x1={140} y1={8} x2={140} y2={42} color={C.model} dashed head={6} />
        <Arrow x1={30} y1={68} x2={96} y2={68} head={6} />
        <Arrow x1={184} y1={68} x2={250} y2={68} head={6} />
        <Chips x={124} y={122} n={3} size={7} />
        <Arrow x1={140} y1={120} x2={140} y2={94} head={6} />
        <Label x={146} y={18} size={9.5} mono color={C.ink}>C</Label>
        <Label x={34} y={62} size={9.5} mono color={C.ink}>I</Label>
        <Label x={244} y={62} size={9.5} mono color={C.ink} anchor="end">O</Label>
        <Label x={152} y={112} size={9.5} mono color={C.ink}>M</Label>
        <Label x={30} y={84} size={9}>сырьё</Label>
        <Label x={250} y={84} size={9} anchor="end">изделие</Label>
        <Label x={160} y={30} size={9}>нормы</Label>
        <Label x={160} y={133} size={9}>станки</Label>
      </Frame>
    )
  }
  return (
    <Frame title={TITLE} desc={DESC}>
      {/* Блок A0 */}
      <rect x={220} y={108} width={200} height={104} fill={C.ground} stroke={C.ink} strokeWidth={S2} />
      <Label x={320} y={152} size={13} anchor="middle" color={C.ink} weight={600}>Изготовить изделие</Label>
      <Label x={320} y={170} size={11} anchor="middle">по маршрутной карте</Label>
      <Label x={412} y={204} size={11} anchor="end" mono color={C.ink}>A0</Label>

      {/* C — управление сверху (информация, пунктир) */}
      <Arrow x1={276} y1={44} x2={276} y2={108} color={C.model} dashed flow />
      <Arrow x1={364} y1={44} x2={364} y2={108} color={C.model} dashed flow />
      <Label x={268} y={40} size={11} anchor="end" color={C.ink}>программа, сроки</Label>
      <Label x={372} y={40} size={11} color={C.ink}>техкарта, нормы, календарь</Label>
      <Label x={320} y={80} size={12} anchor="middle" mono color={C.ink}>C</Label>

      {/* I — входы слева */}
      <Arrow x1={44} y1={140} x2={220} y2={140} />
      <Arrow x1={44} y1={184} x2={220} y2={184} />
      <Label x={48} y={133} size={11} color={C.ink}>сырьё, материалы</Label>
      <Label x={48} y={177} size={11} color={C.ink}>полуфабрикаты</Label>
      <Label x={48} y={198} size={10} mono>operation_inputs</Label>
      <Label x={196} y={164} size={12} anchor="middle" mono color={C.ink}>I</Label>

      {/* O — выходы справа: материал (сплошная) и данные (пунктир) */}
      <Arrow x1={420} y1={140} x2={600} y2={140} />
      <Arrow x1={420} y1={184} x2={600} y2={184} dashed color={C.muted} />
      <Label x={432} y={133} size={11} color={C.ink}>изделие / полуфабрикат</Label>
      <Label x={432} y={177} size={11} color={C.ink}>факт выполнения</Label>
      <Label x={446} y={164} size={12} anchor="middle" mono color={C.ink}>O</Label>

      {/* M — механизмы снизу */}
      <Chips x={252} y={268} n={3} size={12} />
      <Chips x={350} y={268} n={2} size={12} />
      <Arrow x1={276} y1={266} x2={276} y2={212} />
      <Arrow x1={364} y1={266} x2={364} y2={212} />
      <Label x={274} y={296} size={11} anchor="middle" color={C.ink}>станки (тип РЦ)</Label>
      <Label x={364} y={296} size={11} anchor="middle" color={C.ink}>рабочие</Label>
      <Label x={274} y={310} size={10} anchor="middle" mono>operation_wc_types</Label>
      <Label x={364} y={310} size={10} anchor="middle" mono>workers.skills</Label>
      <Label x={320} y={244} size={12} anchor="middle" mono color={C.ink}>M</Label>

      {/* Легенда грамматики */}
      <Label x={600} y={240} size={10} anchor="end">I — вход · C — управление</Label>
      <Label x={600} y={254} size={10} anchor="end">O — выход · M — механизм</Label>
      <Label x={600} y={276} size={10} anchor="end">сплошная — материал</Label>
      <Label x={600} y={290} size={10} anchor="end">пунктир — информация</Label>
    </Frame>
  )
}
