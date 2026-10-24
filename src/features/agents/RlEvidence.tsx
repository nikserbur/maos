/**
 * «Доказательства · RL против правил» по волнам: V5 (претенденты на отложенных сценариях, снимок
 * 22.10 — устарел), какие ходы делал L2 (вместо абзаца — BarList с таблицей-двойником), A3 (гейт G1
 * пройден, но весь выигрыш — одно казначейское правило: лесной график к трём базам) и A4 (после того
 * как правило стало поведением продукта: C* — строгий чемпион; финальная проверка не завершена —
 * числа гейта не заявляются).
 */
import type { MoveKind } from '../../lib/api'
import { countText, num, pct } from '../../explain/format'
import { BarList, Forest } from '../../ui/charts'
import { Section } from '../../ui/kit'
import { moveLabel } from '../plan/moves/moveKinds'
import { V5, movesCensus, snapDay } from './benchData'
import { V5Table } from './BenchTables'
import { A4S, championShares, gateView, pctV, poolLabel } from './rlLedger'
import { useRlStatus } from './rlStatusStore'

const MOVE_FORMS = ['ход', 'хода', 'ходов'] as const
const VARIANT_FORMS = ['вариант', 'варианта', 'вариантов'] as const

export function RlEvidence() {
  return (
    <>
      <Section id="ag-v5" title="V5 · претенденты RL на отложенных сценариях"
        meta={`IQM по ${num(V5.instances.length, 0)} экземплярам · парный бутстреп · Уилкоксон`}>
        <V5Table />
        <MovesCensus />
      </Section>
      <A3Gate />
      <A4Champion />
    </>
  )
}

function MovesCensus() {
  const c = movesCensus(V5)
  const rows = c.kinds.map((k) => ({ key: k.kind, label: moveLabel(k.kind as MoveKind), labelText: moveLabel(k.kind as MoveKind), value: k.n }))
  const idle = c.idleSeeds.map((s) => `сид ${num(s, 0)}`).join(', ')
  return (
    <BarList rows={rows} fmt={(v) => countText(v, MOVE_FORMS)} valueHeader="Ходов" compact
      title="Какие ходы делал L2" subtitle={`сумма по сидам на базовых отложенных сценариях${idle ? ` · ${idle} — 0 ходов, совпал с EDD` : ''}`}
      ariaLabel="Число структурных ходов L2 по видам" />
  )
}

function A3Gate() {
  const s = useRlStatus()
  const g = gateView(s.status?.gate_a3)
  const a3 = A4S.a3
  const rows = [
    { key: 'rule', label: 'к лучшему правилу', delta: a3.vs_best_rule.iqm, lo: g.ruleCi[0], hi: g.ruleCi[1], share: a3.vs_best_rule.win_share },
    { key: 'champ', label: 'к чемпиону H* (предрегистрация)', delta: a3.vs_champion.iqm, lo: a3.vs_champion.ci95[0], hi: a3.vs_champion.ci95[1] },
    { key: 'strict', label: 'к «эвристика + казначейское правило»', delta: a3.vs_strict.iqm, lo: g.strictCi[0], hi: g.strictCi[1], emphasis: true },
  ]
  return (
    <Section id="ag-a3" title="A3 · гейт G1 пройден, но весь выигрыш — одно правило"
      meta={`${num(a3.n_instances, 0)} экземпляров · ${num(a3.seeds_converged, 0)} сида из ${num(a3.seeds, 0)} сошлись к «гасить кредитную линию излишком кассы»`}>
      <Forest rows={rows} fmt={(v) => pctV(v)} fmtShare={(v) => `${num(Math.round(v * a3.n_instances), 0)} из ${num(a3.n_instances, 0)}`}
        zeroLabel="0 = база"
        title="Выигрыш RL исчезает, когда правило записано в эвристику"
        subtitle="ΔCVaR прибыли, % стоимости портфеля, IQM по экземплярам · 95 %-ДИ бутстрепа"
        ariaLabel="Выигрыш RL волны A3 к трём базам: к лучшему правилу и к чемпиону ДИ правее нуля, к эвристике с казначейским правилом — около нуля" />
    </Section>
  )
}

function A4Champion() {
  const a4 = A4S.a4
  const shares = championShares(a4)
  const rows = shares.map((c) => ({ key: c.id, label: poolLabel(c.id), labelText: poolLabel(c.id), value: c.n, marked: c.id === 'C*' }))
  const v = a4.variants
  const worst = v.reduce((m, x) => Math.min(m, x.val_lo), 0)
  const same = v.filter((x) => x.val_lo === 0 && x.val_hi === 0).length
  return (
    <Section id="ag-a4" title="A4 · после правила в продукте: C* — строгий чемпион"
      meta={<>{num(a4.n_instances, 0)} экземпляров · валидация · снимок {snapDay(A4S.snapshot_date)} · <span className="glyph-setup">проверка на отложенных сценариях (holdout) не завершена — числа гейта не заявляются</span></>}>
      <BarList rows={rows} fmt={(x) => `${num(x, 0)} из ${num(a4.n_instances, 0)}`} max={a4.n_instances} valueHeader="Экземпляров" compact
        title="Чья политика лучшая на валидации" subtitle="лучшая неучащаяся политика по каждому экземпляру"
        ariaLabel={`Чемпион по экземплярам: C* в ${shares[0]?.n ?? 0} из ${a4.n_instances}`} />
      <p className="ag-note">
        {countText(v.length, VARIANT_FORMS)} обучения ({num(Math.min(...v.map((x) => x.decisions_m)), 1)}–{num(Math.max(...v.map((x) => x.decisions_m)), 1)} млн решений):
        ни один не превзошёл C* даже на валидации: {num(same, 0)} из {num(v.length, 0)} совпали с ним, остальные хуже — до {pct(worst, 2)} стоимости портфеля.
      </p>
    </Section>
  )
}
