/**
 * Вкладка «Распределения» (X2 «таблицы, а не стены»; «правка рядом со списком»): DataTable с
 * липкими группами «Изделия (сбыт) · N» и «Сырьё · M», строки 40 px; плотность-миниатюра — только
 * у заданных вручную; фильтр «только заданные вручную (2)»; колонка происхождения — только если
 * есть ручные. Клик по строке открывает редактор в боковой панели справа (таблица остаётся на месте).
 * Массовые действия появляются при отметке строк (≤ 3). Корреляция — одной строкой, если β у всех
 * одинаковы; иначе — тепловая карта ρ ≈ β_s·β_t с таблицей-двойником.
 */
import { useCallback, useMemo, useRef, useState } from 'react'
import type { DistType, PriceDistribution, PriceScenario, Product } from '../../lib/api'
import { money, num, pct } from '../../explain/format'
import { ErrorBoundary } from '../../shell/ErrorBoundary'
import { LEAVE_MESSAGE } from '../../shell/router'
import { Heatmap } from '../../ui/charts'
import { DIST_TYPE_LABEL, DensityMini } from '../../ui/DensityMini'
import { InfoTip } from '../../ui/InfoTip'
import { NoteTip } from '../../ui/NoteTip'
import { ChoiceChip, DataTable, EmptyState, type DataColumn } from '../../ui/kit'
import { ProvenanceBadge } from '../../ui/ProvenanceBadge'
import { DistributionEditor } from './DistributionEditor'
import {
  BETA_DEFAULT, SIGMA_DEFAULT, betaSpread, corrMatrix, distGroupLabel, distRow, distShort, firstPart, isCustomDist, nameParts, tailsLabel, type DistRow,
} from './distModel'
import './scenarios-v2.css'

interface Props {
  sc: PriceScenario
  products: Product[]
  productsFailed: boolean
  onSetDist: (sc: PriceScenario, pid: string, patch: Partial<PriceDistribution>) => Promise<void>
  onSetDists: (sc: PriceScenario, rows: PriceDistribution[]) => Promise<void>
}

const TYPES: readonly DistType[] = ['normal', 'lognormal', 't', 'pareto', 'triangular', 'uniform']
/** Относительная σ выше этого порога помечается ▲. */
const REL_HIGH = 0.2
const CORR_TOP = 10
/** Строк до «Показать все N» — страница не длиннее двух экранов. */
const TABLE_TOP = 30

export function DistributionsTab({ sc, products, productsFailed, onSetDist, onSetDists }: Props) {
  const [sel, setSel] = useState<ReadonlySet<string>>(new Set())
  const [open, setOpen] = useState<string | null>(null)
  const [onlyManual, setOnlyManual] = useState(false)
  const [bulkType, setBulkType] = useState<DistType>('t')
  const dirty = useRef(false)
  const onDirtyChange = useCallback((d: boolean) => { dirty.current = d }, [])
  const rows = useMemo(() => products.map((p) => distRow(sc, p)), [sc, products])
  const manualIds = useMemo(() => new Set(rows.filter(isCustomDist).map((r) => r.p.id)), [rows])
  const shown = onlyManual ? rows.filter((r) => manualIds.has(r.p.id)) : rows
  const all = sel.size === shown.length && shown.length > 0

  const toggle = (id: string) => setSel((s) => { const next = new Set(s); if (next.has(id)) next.delete(id); else next.add(id); return next })
  const openRow = (id: string) => {
    if (id === open) return
    if (dirty.current && !window.confirm(LEAVE_MESSAGE)) return
    setOpen(id)
  }
  const selected = rows.filter((r) => sel.has(r.p.id))
  const applyType = () => { void onSetDists(sc, selected.map((r) => ({ ...(r.d ?? { product_id: r.p.id, mean: r.center, stddev: r.sd, beta: r.beta }), product_id: r.p.id, dist_type: bulkType }))) }
  const resetSel = () => { void onSetDists(sc, selected.map((r) => ({ product_id: r.p.id, dist_type: 'normal' as DistType, mean: r.base, stddev: Math.round(r.base * SIGMA_DEFAULT), beta: BETA_DEFAULT }))) }

  const columns = useMemo<ReadonlyArray<DataColumn<DistRow>>>(() => [
    {
      key: 'sel', sortable: false, className: 'sc2-dtable__sel', width: 'fit',
      title: <input type="checkbox" checked={all} aria-label="выбрать все" onChange={() => setSel(all ? new Set() : new Set(shown.map((r) => r.p.id)))} />,
      render: (r) => <input type="checkbox" checked={sel.has(r.p.id)} aria-label={`выбрать ${r.p.name}`} onClick={(e) => e.stopPropagation()} onChange={() => toggle(r.p.id)} />,
    },
    {
      key: 'name', title: 'Изделие', rowHeader: true, primary: true, get: (r) => r.p.name,
      render: (r) => {
        const n = nameParts(r.p.name)
        return (
          <span className="sc2-dtable__name" title={r.p.name}>
            <span className="sc2-dtable__head">{n.head}</span>
            <span className="sc2-dtable__tail">{n.tail ? `${n.tail} · ` : ''}<span className="sc2-dtable__code">{r.p.code}</span></span>
          </span>
        )
      },
    },
    {
      key: 'dist', title: 'Распределение', width: 'fit', get: (r) => DIST_TYPE_LABEL[r.type],
      render: (r) => (manualIds.has(r.p.id)
        ? <span className="sc2-dtable__density" title={DIST_TYPE_LABEL[r.type]}><DensityMini type={r.type} rel={r.rel} width={40} height={18} /><span>{distShort(r.type)}</span></span>
        : <span className="sc2-muted" title={DIST_TYPE_LABEL[r.type]}>{distShort(r.type)}</span>),
    },
    { key: 'center', title: 'Центр цены, ₽', num: true, minWidth: 12, hint: 'Середина распределения цены; по умолчанию — базовая цена справочника', get: (r) => r.center, render: (r) => <>{money(r.center)}{r.hasOverride && <span className="sc2-muted" title="точечная цена задана в сценарии"> · точечно</span>}</> },
    {
      key: 'rel', title: 'Разброс, % от центра', num: true, minWidth: 12, hint: 'Стандартное отклонение цены σ в процентах от центра', get: (r) => r.rel,
      render: (r) => <span className={r.rel > REL_HIGH ? 'sc2-hi' : undefined} title={`σ = ${money(r.sd)}`}>{r.rel > REL_HIGH && <span aria-hidden="true">▲ </span>}{pct(r.rel, 0)}</span>,
    },
    { key: 'tails', title: 'Границы и хвосты', sortable: false, priority: 3, render: (r) => <span className="sc2-muted num">{tailsLabel(r)}</span> },
    { key: 'beta', title: 'Зависимость от рынка (β)', num: true, minWidth: 14, hint: 'Коэффициент β: 0 — цена независима от рынка, 1 — движется вместе с рынком; связь пары изделий в Портфеле ≈ β·β', get: (r) => r.beta, render: (r) => num(r.beta, 2) },
    ...(manualIds.size > 0 ? [{
      // Только отклонения: «■ вручную» строчным глифом; «по умолчанию» — в счётчике над таблицей, не в каждой строке.
      key: 'prov', title: 'Происхождение', width: 'fit' as const, get: (r: DistRow) => (manualIds.has(r.p.id) ? 1 : 0),
      render: (r: DistRow) => (manualIds.has(r.p.id) ? <ProvenanceBadge provenance="manual" variant="inline" /> : ''),
    }] : []),
  ], [shown, sel, all, manualIds]) // eslint-disable-line react-hooks/exhaustive-deps

  if (productsFailed) return <EmptyState kind="unavailable" title="Изделия не загрузились" quiet>Обновите страницу или проверьте связь с сервером — распределения задаются по изделиям справочника.</EmptyState>
  const current = rows.find((r) => r.p.id === open) ?? null
  const nDefault = rows.length - manualIds.size
  return (
    <div className={`sc2-tab sc2-dist${current ? ' has-panel' : ''}`}>
      <div className="sc2-dist__main">
        <div className="sc2-dist__tools">
          <ChoiceChip pressed={onlyManual} onToggle={() => setOnlyManual((v) => !v)}>только заданные вручную ({num(manualIds.size, 0)})</ChoiceChip>
          <span className="sc2-muted">Оценка по истории появится после импорта факта продаж: сейчас история цен демонстрационная. <InfoTip id="forecast.aic" /></span>
        </div>
        {sel.size > 0 && (
          <div className="sc2-bulk" role="group" aria-label="Действия с отмеченными">
            <span>отмечено <b className="num">{num(sel.size, 0)}</b></span>
            <span className="sc2-inline">
              <select className="form__select" value={bulkType} aria-label="Тип распределения" onChange={(e) => setBulkType(e.target.value as DistType)}>
                {TYPES.map((t) => <option key={t} value={t}>{DIST_TYPE_LABEL[t]}</option>)}
              </select>
              <button type="button" className="btn btn--sm" onClick={applyType}>Применить тип</button>
            </span>
            <button type="button" className="btn btn--sm" onClick={resetSel} title={`нормальное, разброс ${pct(SIGMA_DEFAULT, 0)}, β ${num(BETA_DEFAULT, 1)}`}>Вернуть умолчание</button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setSel(new Set())}>Снять отметки</button>
          </div>
        )}
        <DataTable<DistRow> columns={columns} rows={shown} rowKey={(r) => r.p.id} onRowClick={(r) => openRow(r.p.id)}
          groupBy={(r) => (r.raw ? 'raw' : 'goods')} groupLabel={distGroupLabel}
          rowClassName={(r) => (r.p.id === open ? 'is-chosen' : undefined)} rowTitle={() => 'Открыть редактор распределения'}
          caption="Распределения цен по изделиям" countSlot={`${num(manualIds.size, 0)} вручную · ${num(nDefault, 0)} по умолчанию`}
          empty={onlyManual ? 'Заданных вручную распределений нет' : 'Нет товарных изделий и покупного сырья'} emptyKind={onlyManual ? 'no-results' : 'first-use'}
          onResetFilters={() => setOnlyManual(false)} limit={TABLE_TOP} />
        <Correlation rows={rows.filter((r) => !r.raw)} />
      </div>
      {current && (
        <ErrorBoundary variant="panel" label="Редактор распределения" onClose={() => setOpen(null)} message="Редактор не открылся — закройте панель или повторите.">
          <DistributionEditor key={current.p.id} row={current} onDirtyChange={onDirtyChange} onClose={() => setOpen(null)}
            onSave={(patch) => onSetDist(sc, current.p.id, patch)} />
        </ErrorBoundary>
      )}
    </div>
  )
}

/** Корреляция цен: одной строкой при одинаковых β, иначе — тепловая карта первых десяти изделий. */
function Correlation({ rows }: { rows: readonly DistRow[] }) {
  const spread = betaSpread(rows)
  if (rows.length < 2) return null
  if (spread.uniform) {
    return (
      <p className="sc2-muted sc2-corr-line">
        Связь цен между изделиями в Портфеле: <b className="num">ρ ≈ {num(spread.rho, 2)}</b> для всех пар (у всех изделий связь с рынком β = {num(spread.beta, 2)}, ρ ≈ β·β)
        <NoteTip title="Связь цен между изделиями">
          В Портфеле цены изделий связаны через общий рыночный фактор: корреляция пары ρ ≈ β₁·β₂. Чтобы изделие меньше зависело от рынка,
          уменьшите его «Связь с рынком» в редакторе распределения. Поле «Связь цен между изделиями» во «Условиях» действует на веер цен и сырьё.
        </NoteTip>
      </p>
    )
  }
  const top = rows.slice(0, CORR_TOP)
  const m = corrMatrix(top)
  return (
    <Heatmap className="sc2-corr" title="Связь цен изделий в Портфеле" subtitle={`ρ ≈ β·β по «Связи с рынком», первые ${num(top.length, 0)} изделий сбыта`} rowHeader="Изделие"
      rows={top.map((r, i) => ({ key: r.p.id, label: firstPart(r.p.name), values: m[i] }))} columns={top.map((r) => firstPart(r.p.name))}
      fmt={(v) => num(v, 2)} legendLow="ρ 0 — независимы" legendHigh="ρ 1 — вместе" ariaLabel="Корреляция цен изделий" />
  )
}
