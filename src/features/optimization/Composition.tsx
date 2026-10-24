/**
 * Состав портфеля — таблица кита (X2 «таблицы, а не стены карточек»): изделие · объём · вклад в
 * прибыль · доля в риске, у каждого числа — заголовок с единицей; один бар в ячейке (вклад в
 * прибыль, цвет данных --chart-1); первые 3 строки + «Показать все». Над таблицей — чипы
 * диверсификации: число изделий, концентрация (индекс Херфиндаля — Хиршмана) с «i», наибольшая доля
 * против предела (▲ — только на пределе). Вклад — в одном порядке на колонку (единица в заголовке).
 * Данные и логика не меняются: те же items/diversification результата.
 */
import type { OptPortfolio } from '../../lib/api'
import { countText, num, pct } from '../../explain/format'
import { columnScale } from '../../explain/columnScale'
import { InfoTip } from '../../ui/InfoTip'
import { CapsLabel, Chip, DataTable, type DataColumn } from '../../ui/kit'
import { Meter } from '../../ui/charts'
import { compositionValues } from './optTips'

interface Row { id: string; name: string; qty: number; contribution: number; rc: number }

const PRODUCTS = ['изделие', 'изделия', 'изделий'] as const
/** В свёрнутом виде — три крупнейших по вкладу (X2 «первые N + все N»). */
const TOP = 3
const EPS = 1e-9

interface CompositionProps {
  pf: OptPortfolio
  nameOf: (id: string) => string
  /** Предел доли изделия прогона (result.max_share). */
  limit: number
}

export function PortfolioComposition({ pf, nameOf, limit }: CompositionProps) {
  const rows: Row[] = pf.items.filter((it) => it.qty > 0)
    .map((it) => ({ id: it.product_id, name: nameOf(it.product_id), qty: it.qty, contribution: it.contribution, rc: it.risk_contribution }))
  if (rows.length === 0) return <p className="opt-note">Портфель пуст.</p>
  const d = pf.diversification
  const top = [...rows].sort((a, b) => b.contribution - a.contribution)[0]
  const tips = compositionValues(pf, limit, top?.name)
  const lo = Math.min(0, ...rows.map((r) => r.contribution))
  const hi = Math.max(EPS, ...rows.map((r) => r.contribution))
  const atLimit = d.concentration >= limit - EPS
  const scale = columnScale(rows.map((r) => r.contribution))

  const columns: ReadonlyArray<DataColumn<Row>> = [
    { key: 'name', title: 'Изделие', rowHeader: true, primary: true },
    { key: 'qty', title: 'Объём, шт', num: true, render: (r) => num(r.qty, 0) },
    {
      key: 'contribution', title: `Вклад в прибыль, ${scale.unit}`, num: true,
      render: (r) => (
        <span className="opt-pf__money">
          <Meter value={r.contribution} min={lo} max={hi} tone="accent" className="opt-pf__bar" />
          <span>{scale.fmt(r.contribution)}</span>
        </span>
      ),
    },
    {
      key: 'rc', num: true, sortable: false,
      title: <span className="opt-pf__th">Доля в риске, %<InfoTip id="opt.risk_contribution" values={tips['opt.risk_contribution']} /></span>,
      render: (r) => num(r.rc * 100, 1),
    },
  ]

  return (
    <div className="opt-pf" role="group" aria-label="Состав портфеля">
      <div className="opt-pf__head">
        <p className="text-caps opt-eyebrow"><CapsLabel text="Состав портфеля" /></p>
        <div className="opt-pf__chips">
          <Chip size="sm">{countText(d.n_products, PRODUCTS)}</Chip>
          <span className="opt-pf__chip">
            <Chip size="sm" title="Индекс Херфиндаля — Хиршмана по долям выручки: 0 — выручка размазана, 1 — одно изделие">концентрация {num(d.hhi, 2)}</Chip>
            <InfoTip id="opt.hhi" values={tips['opt.hhi']} />
          </span>
          <span className="opt-pf__chip">
            <Chip size="sm" title={`Доля крупнейшего изделия в выручке; предел прогона — ${pct(limit, 0)}`}>
              {`наибольшая доля ${pct(d.concentration, 0)} (предел ${pct(limit, 0)})`}
              {atLimit && <span className="glyph-setup opt-pf__limit">на пределе</span>}
            </Chip>
            <InfoTip id="opt.max_share" values={tips['opt.max_share']} />
          </span>
        </div>
      </div>
      <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} tight limit={TOP} width="content"
        defaultSort={{ key: 'contribution', dir: 'desc' }} caption="Состав устойчивого портфеля" />
    </div>
  )
}
