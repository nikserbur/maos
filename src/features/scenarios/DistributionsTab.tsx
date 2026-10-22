/**
 * Вкладка «Распределения» [2] (UX-V2 §5.1; X1 §3 п. 6): таблица изделий (сбыт и сырьё) на
 * `DataTable` — липкая шапка, сортировка; плотность-миниатюра только у строк, где распределение
 * задано вручную или отличается от умолчания, иначе текст «нормальное · σ 12 %». Клик по строке
 * открывает редактор (карточка над таблицей) с живой плотностью. Массовые действия: «Применить
 * тип к выбранным», «Сбросить к умолчанию»; «Оценить все по истории» — честно недоступно (R7, R20).
 * Тепловая карта корреляций ρ ≈ β_s·β_t — по первым десяти товарным.
 */
import { useMemo, useState, type CSSProperties } from 'react'
import type { DistType, PriceDistribution, PriceScenario, Product } from '../../lib/api'
import { money, num, pct } from '../../explain/format'
import { DIST_TYPE_LABEL, DensityMini } from '../../ui/DensityMini'
import { CapsLabel } from '../../ui/ParamField'
import { ProvenanceBadge } from '../../ui/ProvenanceBadge'
import { Chip, DataTable, IconButton, type DataColumn } from '../../ui/kit'
import { usePassport } from '../passport/passportStore'
import { BETA_DEFAULT, SIGMA_DEFAULT, distRow, distSummary, isCustomDist, tailsLabel, type DistRow } from './distModel'
import './scenarios-v2.css'

interface Props {
  sc: PriceScenario
  products: Product[]
  onSetDist: (sc: PriceScenario, pid: string, patch: Partial<PriceDistribution>) => void
  onSetDists: (sc: PriceScenario, rows: PriceDistribution[]) => void
}

const TYPES: DistType[] = ['normal', 'lognormal', 't', 'pareto', 'triangular', 'uniform']
/** Относительная σ выше этого порога подсвечивается как высокая. */
const REL_HIGH = 0.2
const CORR_TOP = 10

export function DistributionsTab({ sc, products, onSetDist, onSetDists }: Props) {
  const passport = usePassport()
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [open, setOpen] = useState<string | null>(null)
  const [bulkType, setBulkType] = useState<DistType>('t')
  const rows = useMemo(() => products.map((p) => distRow(sc, p)), [sc, products])
  const synthetic = passport.byCode['r1.59']?.status === 'синтетика'
  const all = sel.size === rows.length && rows.length > 0
  const toggle = (id: string) => setSel((s) => { const next = new Set(s); if (next.has(id)) next.delete(id); else next.add(id); return next })
  const applyType = () => onSetDists(sc, rows.filter((r) => sel.has(r.p.id)).map((r) => ({ ...(r.d ?? { product_id: r.p.id, mean: r.center, stddev: r.sd, beta: r.beta }), product_id: r.p.id, dist_type: bulkType })))
  const resetSel = () => onSetDists(sc, rows.filter((r) => sel.has(r.p.id)).map((r) => ({ product_id: r.p.id, dist_type: 'normal' as DistType, mean: r.base, stddev: Math.round(r.base * SIGMA_DEFAULT), beta: BETA_DEFAULT })))

  const columns = useMemo<ReadonlyArray<DataColumn<DistRow>>>(() => [
    {
      key: 'sel', sortable: false, className: 'sc2-dtable__sel',
      title: <input type="checkbox" checked={all} aria-label="выбрать все" onChange={() => setSel(all ? new Set() : new Set(rows.map((r) => r.p.id)))} />,
      render: (r) => <input type="checkbox" checked={sel.has(r.p.id)} aria-label={`выбрать ${r.p.name}`} onClick={(e) => e.stopPropagation()} onChange={() => toggle(r.p.id)} />,
    },
    { key: 'name', title: 'Изделие', rowHeader: true, get: (r) => r.p.name, render: (r) => <span className="sc2-dtable__name">{r.p.name}<small>{r.p.code}{r.raw ? ' · сырьё' : ''}</small></span> },
    {
      key: 'dist', title: 'Распределение', get: (r) => DIST_TYPE_LABEL[r.type],
      render: (r) => (isCustomDist(r)
        ? <span className="sc2-dtable__density"><DensityMini type={r.type} rel={r.rel} width={110} height={34} /><span>{distSummary(r.type, r.rel)}</span></span>
        : <span className="sc2-muted">{distSummary(r.type, r.rel)}</span>),
    },
    { key: 'center', title: 'Центр', num: true, get: (r) => r.center, render: (r) => <>{money(r.center)}{r.hasOverride && <Chip tone="accent" size="sm" title="точечный оверрайд базовой цены">оверрайд</Chip>}</> },
    { key: 'sd', title: <CapsLabel text="σ" />, num: true, get: (r) => r.sd, render: (r) => money(r.sd) },
    { key: 'rel', title: <CapsLabel text="σ, %" />, num: true, get: (r) => r.rel, render: (r) => <span className={r.rel > REL_HIGH ? 'sc2-hi' : undefined}>{pct(r.rel, 0)}</span> },
    { key: 'tails', title: 'Хвосты', sortable: false, render: (r) => <span className="sc2-muted num">{tailsLabel(r)}</span> },
    { key: 'beta', title: <CapsLabel text="β" />, num: true, get: (r) => r.beta, render: (r) => num(r.beta, 2) },
    {
      key: 'prov', title: 'Происхождение', get: (r) => (r.d ? 1 : 0),
      render: (r) => <ProvenanceBadge provenance={r.d ? 'manual' : 'ui'} status={r.d ? undefined : 'UI'} title={r.d ? 'задано в сценарии' : 'σ = 12 % базовой цены (r1.33), β = 0,7 (r1.31)'} />,
    },
  ], [rows, sel, all]) // eslint-disable-line react-hooks/exhaustive-deps

  const openRow = rows.find((r) => r.p.id === open) ?? null
  const top = rows.filter((r) => !r.raw).slice(0, CORR_TOP)
  return (
    <div className="sc2-tab">
      <div className="sc2-bulk">
        <span className="sc2-inline">выбрано <b className="num">{num(sel.size, 0)}</b></span>
        <span className="sc2-inline">Применить тип к выбранным:
          <select className="plan__select" value={bulkType} onChange={(e) => setBulkType(e.target.value as DistType)}>{TYPES.map((t) => <option key={t} value={t}>{DIST_TYPE_LABEL[t]}</option>)}</select>
          <button type="button" className="btn btn--sm" disabled={sel.size === 0} onClick={applyType}>Применить</button>
        </span>
        <button type="button" className="btn btn--sm" disabled={sel.size === 0} onClick={resetSel}>Сбросить к умолчанию (σ 12 %, β 0,7)</button>
        <span className="sc2-estimate">
          <button type="button" className="btn btn--sm" disabled title="Оценка недоступна без план-факта">Оценить все по истории</button>
          <span className="sc2-muted">оценка недоступна без план-факта: истории цен {synthetic ? 'синтетические (ts_data.synthetic = 1, R7)' : 'без флага факта'}, калибровка заблокирована до импорта (R20); подбор семейства по AIC — в прогнозе</span>
        </span>
      </div>

      {openRow && (
        <div className="dk-card sc2-editor-card">
          <div className="dk-card__head">
            <span className="dk-card__title">{openRow.p.name} <span className="dk-card__meta">{openRow.p.code}{openRow.raw ? ' · сырьё' : ''}</span></span>
            <IconButton icon="close" size="sm" variant="ghost" title="Закрыть редактор" onClick={() => setOpen(null)} />
          </div>
          <DistributionEditor row={openRow} onChange={(patch) => onSetDist(sc, openRow.p.id, patch)} />
        </div>
      )}

      <DataTable<DistRow> columns={columns} rows={rows} rowKey={(r) => r.p.id} onRowClick={(r) => setOpen(open === r.p.id ? null : r.p.id)}
        rowClassName={(r) => [r.p.id === open ? 'is-open' : '', r.raw ? 'is-raw' : ''].filter(Boolean).join(' ') || undefined}
        rowTitle={() => 'Открыть редактор распределения'} caption="Распределения цен по изделиям" empty="Нет товарных изделий и покупного сырья" tight />

      {top.length > 1 && (
        <section className="sc2-corr" aria-label="Корреляция цен по β">
          <h3 className="sc2-group__t text-caps">Корреляционная матрица из <CapsLabel text="β" /> <span className="sc2-group__affects">ρ_st ≈ β_s·β_t (общий рыночный фактор; первые {num(top.length, 0)} товарных)</span></h3>
          <div className="sc2-corr__grid" style={{ '--cols': top.length } as CSSProperties}>
            <span />
            {top.map((c) => <span key={c.p.id} className="sc2-corr__h" title={c.p.name}>{c.p.code || c.p.name.slice(0, 6)}</span>)}
            {top.map((rr) => [
              <span key={`${rr.p.id}-l`} className="sc2-corr__l" title={rr.p.name}>{rr.p.name}</span>,
              ...top.map((c) => {
                const rho = rr.p.id === c.p.id ? 1 : Math.min(1, rr.beta * c.beta)
                return <span key={`${rr.p.id}-${c.p.id}`} className="sc2-corr__cell" style={{ '--rho': rho } as CSSProperties} title={`${rr.p.name} × ${c.p.name}: ρ ≈ ${num(rho, 2)}`}>{num(rho, 2)}</span>
              }),
            ])}
          </div>
        </section>
      )}
    </div>
  )
}

function DistributionEditor({ row, onChange }: { row: DistRow; onChange: (patch: Partial<PriceDistribution>) => void }) {
  return (
    <div className="sc2-editor">
      <DensityMini type={row.type} rel={row.rel} width={180} height={56} />
      <label className="sc2-inline">Тип
        <select className="plan__select" value={row.type} onChange={(e) => onChange({ dist_type: e.target.value as DistType })}>{TYPES.map((t) => <option key={t} value={t}>{DIST_TYPE_LABEL[t]}</option>)}</select>
      </label>
      <label className="sc2-inline">Центр <input className="plan__input" type="number" value={row.center} onChange={(e) => onChange({ mean: e.target.value })} /> <span className="sc2-muted">база {money(row.base)}</span></label>
      <label className="sc2-inline">σ <input className="plan__input" type="number" value={row.sd} onChange={(e) => onChange({ stddev: e.target.value })} /> <span className="sc2-muted">{pct(row.rel, 1)}</span></label>
      <label className="sc2-inline">мин <input className="plan__input" type="number" value={row.d?.min_val ?? ''} placeholder="—" onChange={(e) => onChange({ min_val: e.target.value })} /></label>
      <label className="sc2-inline">макс <input className="plan__input" type="number" value={row.d?.max_val ?? ''} placeholder="—" onChange={(e) => onChange({ max_val: e.target.value })} /></label>
      <label className="sc2-inline">β <input className="plan__input" type="number" min={0} max={1.5} step={0.05} value={row.beta} onChange={(e) => onChange({ beta: e.target.value })} /></label>
      <span className="sc2-muted">Правка — в сценарий (сохраняется с задержкой 400 мс); «Оценить» по истории — после импорта факта.</span>
    </div>
  )
}
