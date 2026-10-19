/**
 * Теория ограничений: «барабан — буфер — канат» (DBR, Goldratt). Узкое место —
 * тип РЦ с максимальной загрузкой u_w (Σ продуктивного времени / календарный фонд).
 * Буфер (зерно заделов) защищает барабан от вариативности; канат (пунктир) —
 * запуск материалов в темпе барабана. Эффективная мощность = min(станков, операторов).
 */
import type { DiagramProps } from './types'
import { C, S1, S2, Arrow, CurveArrow, Frame, Label, grainInDisc, triPoints } from './primitives'

interface Station { name: string; u: number; k: number; o: number }
const STATIONS: Station[] = [
  { name: 'Резка', u: 0.62, k: 2, o: 3 },
  { name: 'Сварка', u: 0.78, k: 3, o: 3 },
  { name: 'Окраска', u: 0.97, k: 3, o: 2 },
  { name: 'Сборка', u: 0.7, k: 2, o: 2 },
]
const DRUM = STATIONS.reduce((b, s, i) => (s.u > STATIONS[b].u ? i : b), 0)
const BUFFER_FULL = grainInDisc(0, 0, 15, 22, 9)
const BUFFER_COMPACT = grainInDisc(0, 0, 8, 12, 9)

const TITLE = 'Теория ограничений: барабан — буфер — канат'
const DESC =
  `Поток через четыре типа РЦ; узкое место — «${STATIONS[DRUM].name}» с загрузкой ${Math.round(STATIONS[DRUM].u * 100)} %. ` +
  'Перед ним буфер заделов, канат связывает запуск материалов с темпом узкого места. ' +
  `Эффективная мощность узкого места ограничена операторами: min(${STATIONS[DRUM].k}, ${STATIONS[DRUM].o}).`

export function Toc({ compact }: DiagramProps) {
  const g = compact
    ? { x0: 44, dx: 60, y: 76, sq: 18, barH: 34, fs: 9.5, relX: 14 }
    : { x0: 132, dx: 128, y: 122, sq: 30, barH: 56, fs: 11, relX: 44 }
  const cx = (i: number) => g.x0 + i * g.dx
  const buf = compact ? BUFFER_COMPACT : BUFFER_FULL
  const bufX = (cx(DRUM - 1) + cx(DRUM)) / 2 + (compact ? 4 : 8)

  return (
    <Frame compact={compact} title={TITLE} desc={DESC}>
      {/* Запуск материалов ▲ и поток (сплошная) */}
      <polygon points={triPoints(g.relX, g.y, compact ? 12 : 18, compact ? 14 : 20)} fill={C.ink} />
      <line x1={g.relX + 8} y1={g.y} x2={cx(STATIONS.length - 1)} y2={g.y} stroke={C.ink} strokeWidth={S2} />
      <Arrow x1={cx(STATIONS.length - 1)} y1={g.y} x2={cx(STATIONS.length - 1) + g.dx * 0.62} y2={g.y} width={S2} head={compact ? 7 : 10} />

      {/* Буфер — зерно заделов перед барабаном */}
      {buf.map(([px, py], i) => <circle key={i} cx={bufX + px} cy={g.y + py} r={compact ? 1.2 : 1.8} fill={C.bone} />)}

      {STATIONS.map((s, i) => {
        const isDrum = i === DRUM
        const bh = s.u * g.barH
        const top = g.y - g.sq / 2 - 8
        return (
          <g key={s.name}>
            <rect x={cx(i) - g.sq / 2} y={g.y - g.sq / 2} width={g.sq} height={g.sq}
              fill={isDrum ? C.goal : C.ground} stroke={isDrum ? C.goal : C.ink} strokeWidth={S1} />
            <rect x={cx(i) - 3} y={top - bh} width={6} height={bh} fill={isDrum ? C.goal : C.model} opacity={isDrum ? 1 : 0.7} />
            <Label x={cx(i) + 8} y={top - bh + 8} size={g.fs - 0.5} color={C.ink}>{`${Math.round(s.u * 100)} %`}</Label>
            <Label x={cx(i)} y={g.y + g.sq / 2 + (compact ? 11 : 16)} size={g.fs} anchor="middle" color={C.ink} weight={isDrum ? 600 : undefined}>
              {compact ? s.name.slice(0, 4) + '.' : s.name}
            </Label>
          </g>
        )
      })}

      {/* Канат: от барабана к запуску (информация) */}
      <CurveArrow
        from={[cx(DRUM), g.y - g.sq / 2 - 8 - g.barH - 6]}
        ctrl={[(cx(DRUM) + g.relX) / 2, compact ? -6 : -30]}
        to={[g.relX, g.y - (compact ? 10 : 14)]}
        dashed color={C.model} flow head={compact ? 5 : 7}
      />

      {compact ? (
        <g>
          <Label x={cx(DRUM)} y={136} size={9.5} anchor="middle" color={C.ink}>барабан = argmax u</Label>
        </g>
      ) : (
        <g>
          <Label x={196} y={46} size={10.5} color={C.ink}>канат: темп барабана</Label>
          <Label x={bufX} y={g.y + 46} size={10.5} anchor="middle">буфер</Label>
          <Label x={cx(DRUM)} y={g.y + 62} size={10.5} anchor="middle" color={C.ink} weight={600}>барабан (узкое место)</Label>
          <Label x={cx(STATIONS.length - 1) + 22} y={g.y - 10} size={10.5}>темп выпуска</Label>
          <Label x={g.relX - 4} y={g.y + 30} size={10.5}>запуск</Label>

          {/* Эффективная мощность узкого места */}
          <line x1={24} y1={212} x2={616} y2={212} stroke={C.grid} />
          <Label x={24} y={234} size={11} color={C.ink} weight={600}>{`Эффективная мощность «${STATIONS[DRUM].name}»`}</Label>
          {Array.from({ length: STATIONS[DRUM].k }, (_, i) => {
            const staffed = i < STATIONS[DRUM].o
            return (
              <g key={i}>
                <rect x={36 + i * 34} y={248} width={24} height={24} fill={staffed ? C.goal : 'none'}
                  fillOpacity={staffed ? 0.85 : undefined} stroke={staffed ? C.goal : C.muted} strokeWidth={S1}
                  strokeDasharray={staffed ? undefined : '3 2'} />
                {staffed && <circle cx={48 + i * 34} cy={286} r={4} fill={C.ink} />}
              </g>
            )
          })}
          <Label x={36} y={306} size={10}>■ станки K = 3 · ● операторы O = 2</Label>
          <Label x={252} y={250} size={10.5} mono color={C.ink}>{'c_{w} = min(K_{w}, O_{w}) · фонд_{w}'}</Label>
          <Label x={252} y={270} size={10.5} mono color={C.ink}>{'w* = argmax_{w} u_{w}'}</Label>
          <Label x={252} y={290} size={10.5} mono color={C.ink}>{'u_{w} = Σ продуктивного / календарный фонд'}</Label>
          <Label x={252} y={308} size={10}>«упор в труд»: третий станок простаивает без оператора</Label>
        </g>
      )}
    </Frame>
  )
}
