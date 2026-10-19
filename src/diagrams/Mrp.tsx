/**
 * MRP (Orlicky): запись по периодам для одного изделия.
 * NR_t = max(0, GR_t + SS − OH_{t−1}); поступление = ⌈NR/Q⌉·Q (кратность партии);
 * запуск смещён на срок изготовления ПАРТИИ LT = ⌈(t_нал + Q·t_ед)/T_периода⌉
 * (исправление B14: раньше смещали на время одной единицы — даты запуска слишком поздние).
 */
import type { DiagramProps } from './types'
import { C, S1, CurveArrow, Frame, Label, triPoints } from './primitives'

const GROSS = [0, 20, 15, 30, 10, 25, 0, 20]
const OH0 = 30
const SS = 10
const LOT = 40
const T_SETUP = 2
const T_UNIT = 0.35
const T_PERIOD = 8
const LT = Math.ceil((T_SETUP + LOT * T_UNIT) / T_PERIOD)
const LT_UNIT = Math.ceil((T_SETUP + T_UNIT) / T_PERIOD)

interface Rec { gr: number; oh: number; nr: number; rec: number; rel: number }
const RECORD: Rec[] = (() => {
  const out: Rec[] = GROSS.map((gr) => ({ gr, oh: 0, nr: 0, rec: 0, rel: 0 }))
  let oh = OH0
  GROSS.forEach((gr, t) => {
    const avail = oh - gr
    const nr = Math.max(0, gr + SS - oh)
    const rec = nr > 0 ? Math.ceil(nr / LOT) * LOT : 0
    oh = avail + rec
    out[t] = { ...out[t], nr, rec, oh }
    if (rec > 0 && t - LT >= 0) out[t - LT] = { ...out[t - LT], rel: rec }
  })
  return out
})()

const ROWS: Array<{ key: keyof Rec; label: string; abbr: string }> = [
  { key: 'gr', label: 'Валовая потребность', abbr: 'GR' },
  { key: 'oh', label: 'Прогнозный запас', abbr: 'OH' },
  { key: 'nr', label: 'Чистая потребность', abbr: 'NR' },
  { key: 'rec', label: 'План. поступление', abbr: 'PORc' },
  { key: 'rel', label: 'План. запуск', abbr: 'PORel' },
]

const TITLE = 'MRP: валовая → чистая потребность → партия → запуск со смещением'
const DESC =
  `Запись MRP по 8 периодам: начальный запас ${OH0}, страховой ${SS}, партия ${LOT}. Чистая потребность ` +
  `покрывается партиями, запуск смещён на срок изготовления партии LT = ${LT} периода (а не на время одной единицы).`

export function Mrp({ compact }: DiagramProps) {
  const rows = compact ? ROWS.filter((r) => r.key === 'gr' || r.key === 'rec' || r.key === 'rel') : ROWS
  const g = compact
    ? { lx: 6, cx0: 62, cw: 26, y0: 22, rh: 30, fs: 9.5 }
    : { lx: 16, cx0: 200, cw: 52, y0: 52, rh: 30, fs: 11 }
  const rowY = (i: number) => g.y0 + i * g.rh
  const relRow = rows.findIndex((r) => r.key === 'rel')
  const recRow = rows.findIndex((r) => r.key === 'rec')

  return (
    <Frame compact={compact} title={TITLE} desc={DESC}>
      {/* Заголовок периодов */}
      {GROSS.map((_, t) => (
        <Label key={t} x={g.cx0 + t * g.cw + g.cw / 2} y={g.y0 - 8} size={g.fs - 0.5} anchor="middle">{String(t + 1)}</Label>
      ))}
      {!compact && <Label x={g.lx} y={g.y0 - 8} size={10.5}>{`период (T = ${T_PERIOD} ч)`}</Label>}

      {rows.map((r, i) => (
        <g key={r.key}>
          <line x1={g.lx} y1={rowY(i)} x2={g.cx0 + 8 * g.cw} y2={rowY(i)} stroke={C.grid} />
          <Label x={g.lx} y={rowY(i) + g.rh * 0.62} size={g.fs} color={C.ink}>{compact ? r.abbr : r.label}</Label>
          {!compact && <Label x={g.cx0 - 8} y={rowY(i) + g.rh * 0.62} size={9.5} anchor="end" mono>{r.abbr}</Label>}
          {RECORD.map((rec, t) => {
            const v = rec[r.key]
            const isRel = r.key === 'rel' && v > 0
            return (
              <g key={t}>
                {isRel && <rect x={g.cx0 + t * g.cw + 2} y={rowY(i) + 3} width={g.cw - 4} height={g.rh - 6} fill={C.goal} fillOpacity={0.85} />}
                {r.key === 'rec' && v > 0 && (
                  <rect x={g.cx0 + t * g.cw + 2} y={rowY(i) + 3} width={g.cw - 4} height={g.rh - 6} fill="none" stroke={C.model} strokeWidth={S1} />
                )}
                <Label x={g.cx0 + t * g.cw + g.cw / 2} y={rowY(i) + g.rh * 0.62} size={g.fs} anchor="middle"
                  color={v > 0 || r.key === 'oh' ? C.ink : C.muted} mono>
                  {v > 0 || r.key === 'oh' ? String(v) : '·'}
                </Label>
              </g>
            )
          })}
        </g>
      ))}
      <line x1={g.lx} y1={rowY(rows.length)} x2={g.cx0 + 8 * g.cw} y2={rowY(rows.length)} stroke={C.grid} />

      {/* Смещение на срок изготовления партии: поступление → запуск */}
      {RECORD.map((rec, t) => rec.rec > 0 && t - LT >= 0 && (
        <CurveArrow key={t}
          from={[g.cx0 + t * g.cw + g.cw / 2, rowY(recRow) + g.rh - 3]}
          ctrl={[g.cx0 + (t - LT / 2) * g.cw + g.cw / 2, rowY(relRow) + g.rh * (compact ? 0.9 : 1.6)]}
          to={[g.cx0 + (t - LT) * g.cw + g.cw / 2 + 6, rowY(relRow) + g.rh - 2]}
          color={C.ink} head={compact ? 5 : 6} width={1.2}
        />
      ))}

      {!compact && (
        <g>
          <Label x={g.cx0 + 8 * g.cw} y={rowY(rows.length) + 40} size={10.5} anchor="end" color={C.ink}>{`↶ смещение LT = ${LT} периода`}</Label>
          <Label x={g.lx} y={rowY(rows.length) + 40} size={10.5} mono color={C.ink}>{'NR_{t} = max(0, GR_{t} + SS − OH_{t−1})'}</Label>
          <Label x={g.lx} y={rowY(rows.length) + 58} size={10.5} mono color={C.ink}>{'PORc_{t} = ⌈NR_{t}/Q⌉·Q,  PORel_{t−LT} = PORc_{t}'}</Label>
          <Label x={g.lx} y={rowY(rows.length) + 76} size={10.5} mono color={C.ink}>{'LT = ⌈(t_{нал} + Q·t_{ед}) / T⌉'}</Label>
          <polygon points={triPoints(g.lx + 5, rowY(rows.length) + 92, 9, 10)} fill={C.goal} />
          <Label x={g.lx + 16} y={rowY(rows.length) + 96} size={10}>
            {`план. запуск — решение MRP · B14: смещение на одну единицу дало бы LT = ${LT_UNIT} — запуск слишком поздно`}
          </Label>
        </g>
      )}
    </Frame>
  )
}
