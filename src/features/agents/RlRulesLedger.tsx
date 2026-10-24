/**
 * Реестр «Правила, найденные RL» (протокол «RL → эвристика», THESIS-FINDINGS В1): что RL нашёл, в
 * какой волне и сколько запусков совпало, эффект с 95 %-ДИ и «лучше в N из M», как проверено (чип
 * «выведено RL · G1 ✓ · строгий контроль ≈ 0» или «кандидат»), что стало в продукте — со ссылкой на
 * узел карты. Строки — из gate_a3 (живой, как у MENTAT) или снимка a4_summary.json.
 */
import { Chip, DataTable, Section, type DataColumn } from '../../ui/kit'
import { useRlStatus } from './rlStatusStore'
import { A4S, gateView, ledgerRows, type LedgerRow } from './rlLedger'
import { snapDay } from './benchData'

const COLS: ReadonlyArray<DataColumn<LedgerRow>> = [
  { key: 'rule', title: 'Правило', rowHeader: true, primary: true, sortable: false },
  { key: 'origin', title: 'Откуда', sortable: false, minWidth: 12, className: 'ag-muted' },
  {
    key: 'effect', title: 'Эффект к лучшему правилу, % портфеля', sortable: false, num: true,
    hint: 'Доля стоимости портфеля; во второй строке — диапазон, в котором эффект лежит с вероятностью 95 %',
    render: (r) => <span className="ag-cell2"><span>{r.effect}</span><span className="ag-cell2__sub">{r.effectNote}</span></span>,
  },
  {
    key: 'check', title: 'Проверка', sortable: false, minWidth: 14,
    render: (r) => <Chip size="sm" className={r.check.kind === 'candidate' ? 'ag-chip--candidate' : undefined}>{r.check.text}</Chip>,
  },
  {
    key: 'status', title: 'Статус в продукте', sortable: false, minWidth: 16,
    render: (r) => (r.status.href
      ? <a className="ag-link" href={r.status.href} title={r.status.code ? `Ключ настройки: ${r.status.code}` : undefined}>{r.status.text} ↗</a>
      : <span className="ag-muted">{r.status.text}</span>),
  },
]

export function RlRulesLedger() {
  const s = useRlStatus()
  const g = gateView(s.status?.gate_a3)
  const rows = ledgerRows(g)
  return (
    <Section id="ag-ledger" title="Правила, найденные RL"
      meta={`RL прогоняется один раз — найденное становится обычным правилом после проверки · ${g.source === 'live' ? 'гейт — с сервера' : `снимок ${snapDay(A4S.snapshot_date)}`}`}>
      <DataTable columns={COLS} rows={rows} rowKey={(r) => r.id} caption="Правила, найденные RL, и их статус в продукте" />
    </Section>
  )
}
