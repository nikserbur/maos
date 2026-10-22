/**
 * Вкладка «Распределения» [2] (UX-V2 §5.1): таблица изделий (сбыт и сырьё) — плотность-миниатюра, тип,
 * центр (база / оверрайд), σ абс. и % от базы, хвосты (мин/макс), β к рыночному фактору, происхождение
 * (manual / default 12 % [UI]). Массовые действия: «Применить тип к выбранным», «Сбросить к умолчанию»,
 * «Оценить все по истории» — честно недоступно: истории цен синтетические (R7), план-факта нет (R20).
 * Строка раскрывается в редактор с живой плотностью. Тепловая карта корреляций ρ ≈ β_s·β_t.
 */
import { useMemo, useState } from 'react'
import type { DistType, PriceDistribution, PriceScenario, Product } from '../../lib/api'
import { money, num, pct } from '../../explain/format'
import { DIST_TYPE_LABEL, DensityMini } from '../../ui/DensityMini'
import { ProvenanceBadge } from '../../ui/ProvenanceBadge'
import { usePassport } from '../passport/passportStore'
import { Chip } from '../plan/ui'
import './scenarios-v2.css'

interface Props {
  sc: PriceScenario
  products: Product[]
  onSetDist: (sc: PriceScenario, pid: string, patch: Partial<PriceDistribution>) => void
  onSetDists: (sc: PriceScenario, rows: PriceDistribution[]) => void
}

const TYPES: DistType[] = ['normal', 'lognormal', 't', 'pareto', 'triangular', 'uniform']
const SIGMA_DEFAULT = 0.12
const BETA_DEFAULT = 0.7

export function DistributionsTab({ sc, products, onSetDist, onSetDists }: Props) {
  const passport = usePassport()
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [open, setOpen] = useState<string | null>(null)
  const [bulkType, setBulkType] = useState<DistType>('t')
  const rows = useMemo(() => products.map((p) => {
    const d = sc.distributions?.find((x) => x.product_id === p.id)
    const raw = p.purchased === '1'
    const ovr = sc.overrides?.find((o) => o.product_id === p.id)
    const base = Number((raw ? p.base_cost : p.base_price) || 0)
    const center = d ? Number(d.mean) || base : Number(ovr?.base_price ?? ovr?.base_cost ?? base)
    const sd = d ? Number(d.stddev) || 0 : Math.round(base * SIGMA_DEFAULT)
    return { p, raw, d, base, ovr, center, sd, rel: center > 0 ? sd / center : SIGMA_DEFAULT, beta: d?.beta !== undefined ? Number(d.beta) : BETA_DEFAULT, type: d?.dist_type ?? 'normal' as DistType }
  }), [sc, products])
  const synthetic = passport.byCode['r1.59']?.status === 'синтетика'
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const all = sel.size === rows.length
  const applyType = () => onSetDists(sc, rows.filter((r) => sel.has(r.p.id)).map((r) => ({ ...(r.d ?? { product_id: r.p.id, mean: r.center, stddev: r.sd, beta: r.beta }), product_id: r.p.id, dist_type: bulkType })))
  const resetSel = () => onSetDists(sc, rows.filter((r) => sel.has(r.p.id)).map((r) => ({ product_id: r.p.id, dist_type: 'normal' as DistType, mean: r.base, stddev: Math.round(r.base * SIGMA_DEFAULT), beta: BETA_DEFAULT })))

  const top = rows.filter((r) => !r.raw).slice(0, 10)
  return (
    <div className="sc2-tab">
      <div className="sc2-bulk">
        <label className="sc2-inline"><input type="checkbox" checked={all && rows.length > 0} onChange={() => setSel(all ? new Set() : new Set(rows.map((r) => r.p.id)))} aria-label="выбрать все" /> выбрано {sel.size}</label>
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

      <table className="sc2-dtable">
        <thead><tr>
          <th aria-label="выбор" /><th>Изделие</th><th>Плотность</th><th>Тип</th><th>Центр</th><th>σ</th><th>σ, %</th><th>Хвосты</th><th>β</th><th>Происхождение</th>
        </tr></thead>
        <tbody>
          {rows.map((r) => {
            const prov = r.d ? 'manual' : 'ui'
            const isOpen = open === r.p.id
            return [
              <tr key={r.p.id} className={`${isOpen ? 'is-open' : ''}${r.raw ? ' is-raw' : ''}`} onClick={() => setOpen(isOpen ? null : r.p.id)}>
                <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={sel.has(r.p.id)} onChange={() => toggle(r.p.id)} aria-label={`выбрать ${r.p.name}`} /></td>
                <td className="sc2-dtable__name">{r.p.name}<small>{r.p.code}{r.raw ? ' · сырьё' : ''}</small></td>
                <td><DensityMini type={r.type} rel={r.rel} width={110} height={34} /></td>
                <td>{DIST_TYPE_LABEL[r.type]}</td>
                <td className="num">{money(r.center)}{r.ovr && <Chip tone="accent" title="точечный оверрайд базовой цены">овр</Chip>}</td>
                <td className="num">{money(r.sd)}</td>
                <td className={`num${r.rel > 0.2 ? ' sc2-hi' : ''}`}>{pct(r.rel, 0)}</td>
                <td className="num sc2-muted">{r.d?.min_val || r.d?.max_val ? `${r.d.min_val ?? '−∞'} … ${r.d.max_val ?? '+∞'}` : r.type === 't' ? 'ν = 5 [НОРМ]' : r.type === 'pareto' ? 'α = 2,3 [UI]' : '—'}</td>
                <td className="num">{num(r.beta, 2)}</td>
                <td><ProvenanceBadge provenance={prov} status={r.d ? undefined : 'UI'} title={r.d ? 'задано в сценарии' : 'σ = 12 % базовой цены (r1.33), β = 0,7 (r1.31)'} /></td>
              </tr>,
              isOpen && (
                <tr key={`${r.p.id}-edit`} className="sc2-editor-row">
                  <td colSpan={10}>
                    <DistributionEditor row={r} onChange={(patch) => onSetDist(sc, r.p.id, patch)} />
                  </td>
                </tr>
              ),
            ]
          })}
        </tbody>
      </table>

      {top.length > 1 && (
        <section className="sc2-corr" aria-label="Корреляция цен по β">
          <p className="sc2-group__t text-caps">Корреляционная матрица из β <span className="sc2-muted">ρ_st ≈ β_s·β_t (общий рыночный фактор; первые {top.length} товарных)</span></p>
          <div className="sc2-corr__grid" style={{ gridTemplateColumns: `120px repeat(${top.length}, 1fr)` }}>
            <span />
            {top.map((c) => <span key={c.p.id} className="sc2-corr__h" title={c.p.name}>{c.p.code || c.p.name.slice(0, 6)}</span>)}
            {top.map((rr) => [
              <span key={`${rr.p.id}-l`} className="sc2-corr__l" title={rr.p.name}>{rr.p.name}</span>,
              ...top.map((c) => {
                const rho = rr.p.id === c.p.id ? 1 : Math.min(1, rr.beta * c.beta)
                return <span key={`${rr.p.id}-${c.p.id}`} className="sc2-corr__cell" style={{ background: `color-mix(in oklch, var(--ultramarine) ${Math.round(rho * 80)}%, var(--bg-card))` }} title={`${rr.p.name} × ${c.p.name}: ρ ≈ ${rho.toFixed(2)}`}>{rho.toFixed(2)}</span>
              }),
            ])}
          </div>
        </section>
      )}
    </div>
  )
}

type Row = { p: Product; d?: PriceDistribution; base: number; center: number; sd: number; rel: number; beta: number; type: DistType }

function DistributionEditor({ row, onChange }: { row: Row; onChange: (patch: Partial<PriceDistribution>) => void }) {
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
