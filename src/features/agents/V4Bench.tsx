/**
 * «Доказательства · Расписание против BKS» (V4 волны A2): сначала ответ графиком — малые панели по
 * семействам на общей шкале, медиана разрыва каждого метода по возрастанию, CP-SAT — `--chart-1`,
 * остальные серые, с таблицей-двойником; таблица всех экземпляров — по запросу («Все экземпляры (32)»),
 * по умолчанию только разрывы, длина расписания (Cmax) — переключателем. Статус CP-SAT — глиф отдельно от секунд.
 * Раскрытие и режим таблицы живут в адресе.
 */
import { hours, num, signed } from '../../explain/format'
import { ruleLabel } from '../../explain/labels'
import { ruleWords } from '../plan/ruleWords'
import { BarList, ChartFrame, type ChartTable } from '../../ui/charts'
import { Chip, ChoiceChip, DataTable, type DataColumn } from '../../ui/kit'
import { useHashParams } from '../../shell/router'
import { snapDay } from './benchData'
import {
  AT_BKS_TOL, FAMILY_LABEL, FAMILY_NOTE, METHOD_LABEL, V4A2, familyMedians, familyOf, gapOf, refOf, ruleEvent, ruleLagRange, sharedMax, summarizeA2,
  type V4A2Row, type V4Method,
} from './benchV4'
import { Head } from './BenchTables'

const gapText = (g: number | null) => (g === null ? '—' : signed(g, '%'))

/** Значение Cmax/F: эталонные задачи — в единицах эталона, MAOS — часы. */
const valueText = (r: V4A2Row, v: number | null) => (v === null ? '—' : familyOf(r.name) === 'maos' ? hours(v) : num(v, 0))

/** Статус CP-SAT — нейтральный чип с глифом: оптимум доказан (●) или лимит времени исчерпан (○). */
function CpsatStatus({ r }: { r: V4A2Row }) {
  return r.cpsat_status === 'OPTIMAL'
    ? <Chip size="sm" title="CP-SAT доказал оптимальность">● оптимум</Chip>
    : <Chip size="sm" title="Лимит времени исчерпан: решение без доказательства оптимальности">○ допустимое</Chip>
}

const gapCol = (m: V4Method): DataColumn<V4A2Row> => ({
  key: `g_${m}`, title: <Head id="agent.gap_bks">{METHOD_LABEL[m]}</Head>, num: true, sortable: false, get: (r) => gapOf(r, m), render: (r) => gapText(gapOf(r, m)),
})
const valCol = (m: V4Method): DataColumn<V4A2Row> => ({
  key: `v_${m}`, title: <Head id="agent.gap_bks">{METHOD_LABEL[m]}</Head>, num: true, sortable: false, get: (r) => r[m], render: (r) => valueText(r, r[m]),
})

const NAME: DataColumn<V4A2Row> = { key: 'name', title: <Head id="agent.gap_bks">Экземпляр</Head>, rowHeader: true, primary: true, sortable: false }
const RULE: DataColumn<V4A2Row> = {
  key: 'best_rule', title: <Head id="plan.rule_score">Лучшее правило</Head>, sortable: false, minWidth: 16,
  render: (r) => <span title={`Код правила: ${ruleLabel(r.best_rule)}`}>{ruleWords(r.best_rule)}</span>,
}

const GAP_COLS: ReadonlyArray<DataColumn<V4A2Row>> = [
  NAME, RULE, gapCol('rule'), gapCol('ga'), gapCol('ga_warm'), gapCol('cpsat'),
  { key: 'status', title: <Head id="agent.cpsat_status">Статус CP-SAT</Head>, sortable: false, render: (r) => <CpsatStatus r={r} /> },
  { key: 'sec', title: <Head id="agent.cpsat_status">Время, с</Head>, num: true, sortable: false, render: (r) => num(r.cpsat_sec, 1) },
]

const CMAX_COLS: ReadonlyArray<DataColumn<V4A2Row>> = [
  NAME, RULE, valCol('rule'),
  { key: 'event', title: <Head id="agent.rule_event">Правило, событийный режим</Head>, num: true, sortable: false, render: (r) => valueText(r, ruleEvent(r)) },
  valCol('ga'), valCol('ga_warm'), valCol('cpsat'),
  { key: 'ref', title: <Head id="agent.gap_bks">Эталон</Head>, num: true, sortable: false, render: (r) => valueText(r, refOf(r)) },
]

export function V4Bench() {
  const [params, setParams] = useHashParams()
  const open = params.rows === 'all'
  const cmax = params.cmax === '1'
  const fams = familyMedians(V4A2.rows)
  const max = sharedMax(fams)
  const lag = ruleLagRange(fams)
  const s = summarizeA2(V4A2.rows)
  const title = lag
    ? `Точный солвер — эталон, правила отстают на ${num(Math.round(lag[0] * 100), 0)}–${num(Math.round(lag[1] * 100), 0)} %`
    : 'Точный солвер — эталон для расписания без неопределённости'
  const table: ChartTable = {
    columns: ['Семейство', 'Метод', 'Медиана разрыва'],
    rows: fams.flatMap((f) => f.methods.map((m) => [FAMILY_LABEL[f.family], METHOD_LABEL[m.method], gapText(m.median)])),
    numeric: [2],
  }
  return (
    <div className="ag-bench">
      <ChartFrame title={title} table={table}
        subtitle={`Медиана разрыва к эталону по семействам · общая шкала · CP-SAT ${num(V4A2.cpsat_sec, 0)} с, генетический алгоритм ${num(V4A2.ga_sec, 0)} с · снимок ${snapDay(V4A2.snapshot_date)}`}
        badges={<Chip size="sm" title={`Ровно BKS — ${s.cpsatExact} из ${s.withBks}; ещё ${s.cpsatAtBks - s.cpsatExact} — в пределах ${num(AT_BKS_TOL * 100, 1)} %`}>
          CP-SAT = BKS {num(s.cpsatAtBks, 0)} из {num(s.withBks, 0)} (допуск {num(AT_BKS_TOL * 100, 1)} %)</Chip>}
        ariaLabel={`Медиана разрыва к эталону по семействам задач: ${fams.map((f) => `${FAMILY_LABEL[f.family]} — правило ${gapText(f.methods.find((m) => m.method === 'rule')?.median ?? null)}`).join('; ')}`}>
        <div className="ag-v4chart">
          {fams.map((f) => (
            <BarList key={f.family} compact max={max} color="var(--chart-other)" fmt={(v) => signed(v, '%')} valueHeader="Медиана разрыва"
              title={`${FAMILY_LABEL[f.family]} · ${num(f.n, 0)}`} subtitle={FAMILY_NOTE[f.family]}
              rows={f.methods.map((m) => ({ key: m.method, label: METHOD_LABEL[m.method], labelText: METHOD_LABEL[m.method], value: m.median, marked: m.method === 'cpsat' }))}
              ariaLabel={`${FAMILY_LABEL[f.family]}: медиана разрыва по методам`} />
          ))}
        </div>
      </ChartFrame>

      <div className="ag-bench__bar">
        <button type="button" className="btn btn--ghost btn--sm" aria-expanded={open} aria-controls="ag-v4-table"
          onClick={() => setParams({ rows: open ? null : 'all', cmax: open ? null : params.cmax })}>
          {open ? 'Скрыть экземпляры ▾' : `Все экземпляры (${num(V4A2.rows.length, 0)}) ▸`}
        </button>
        {open && <ChoiceChip pressed={cmax} onToggle={() => setParams({ cmax: cmax ? null : '1' })}>Показать длину расписания</ChoiceChip>}
      </div>
      {open && (
        <div id="ag-v4-table">
          <DataTable columns={cmax ? CMAX_COLS : GAP_COLS} rows={V4A2.rows} rowKey={(r) => r.name} tight framed
            groupBy={(r) => familyOf(r.name)} groupLabel={(k, n) => `${FAMILY_LABEL[k as keyof typeof FAMILY_LABEL]} · ${n} · ${FAMILY_NOTE[k as keyof typeof FAMILY_NOTE]}`}
            caption={cmax ? 'V4: длина расписания по методам и эталон' : 'V4: разрыв к эталону по методам'} />
          <p className="ag-note ag-note--foot">
            Цена детерминизма: под тяжёлыми хвостами жёсткий план CP-SAT хуже лучшего правила по хвосту (A2, на 12 экземплярах) — эталон здесь только для задачи без неопределённости.
          </p>
        </div>
      )}
    </div>
  )
}
