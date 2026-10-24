/**
 * Разбор KPI выбранного построения: рекомендации (простая карточка, приглушённая иконка), сравнение
 * с базой — по умолчанию предыдущее построение («vs №27 (предыдущее)»), та же база, что у Δ на
 * плитках, — и реестр показателей таблицей кита. Отклонение — глиф и слово; норма не подписывается.
 * Пояснения секций — в «i», а не строкой меты.
 */
import { useMemo } from 'react'
import type { KpiBundle } from '../../lib/api'
import { Icon } from '../../shell/icons'
import { InfoTip } from '../../ui/InfoTip'
import { NoteTip } from '../../ui/NoteTip'
import { Chip, DataTable, DeltaChip, IconButton, Section, type DataColumn } from '../../ui/kit'
import { num } from '../../explain/format'
import { KPI_CATALOG, kpiDef, readKpi, type KpiContext, type KpiDef } from './kpiCatalog'
import { DIR_ARROW, DIR_TITLE, STATUS_LABEL, deltaBetter, kpiDeltaText, kpiDeviation, kpiText } from './kpiFormat'
import { buildRecommendations, type TypeLoad } from './analyticsModel'
import { planNo, planOptionLabel, previousPlan, type PlanRef } from './planRuns'

const COMPARE_CODES = ['MAKESPAN', 'MK_CVAR', 'OTD', 'TARD', 'UTIL', 'BN_UTIL', 'THRU', 'COST']
const DEV_GLYPH = { warn: 'glyph-setup', bad: 'glyph-down' } as const

interface KpiRegistryProps {
  /** KPI-блок построения с «влитыми» полями кассы. */
  bundle: KpiBundle
  baseBundle: KpiBundle | null
  baseRef: PlanRef | null
  loads: ReadonlyArray<TypeLoad>
  refs: ReadonlyArray<PlanRef>
  planId: string
  ctx: KpiContext
  /** Подпись источника денежных KPI (водопад кассы) для «i» реестра. */
  cashNote: string
  onBase: (planId: string) => void
  onInvest: (wcTypeId: string) => void
}

export function KpiRegistry({ bundle, baseBundle, baseRef, loads, refs, planId, ctx, cashNote, onBase, onInvest }: KpiRegistryProps) {
  const recs = useMemo(() => buildRecommendations(bundle, loads, ctx), [bundle, loads, ctx])
  return (
    <>
      {recs.length > 0 && (
        <section className="dk-card an-recs" aria-label="Что улучшить">
          <div className="dk-card__head">
            <h2 className="dk-card__title"><Icon name="bulb" size={15} />Что улучшить <InfoTip id="analytics.recommendations" /></h2>
          </div>
          <ul className="an-recs__list">
            {recs.map((r, i) => (
              <li key={`${r.kind}-${i}`} className="an-rec">
                <span className="an-rec__text">{r.text}</span>
                {r.wct && <IconButton icon="money" size="sm" title="Оценить докупку оборудования" onClick={() => onInvest(r.wct!)}>Инвестпроект</IconButton>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <PlanCompare bundle={bundle} baseBundle={baseBundle} baseRef={baseRef} refs={refs} planId={planId} ctx={ctx} onBase={onBase} />

      <Section id="an-registry"
        title={<>Реестр показателей <NoteTip title="Реестр показателей">{num(KPI_CATALOG.length, 0)} показателей; значения — из сохранённого блока построения; {cashNote}. Формулы — в «i» каждой строки.</NoteTip></>}>
        <RegistryTable bundle={bundle} ctx={ctx} />
      </Section>
    </>
  )
}

/* ── Реестр: таблица с группами каталога ───────────────────────────────────── */
function RegistryTable({ bundle, ctx }: { bundle: KpiBundle; ctx: KpiContext }) {
  const columns = useMemo<DataColumn<KpiDef>[]>(() => [
    { key: 'status', title: <span className="dk-vh">Отклонение</span>, sortable: false, width: 'fit', className: 'an-td-status',
      render: (k) => {
        const dev = kpiDeviation(k, k.value(bundle, ctx), bundle)
        return dev ? <span className={DEV_GLYPH[dev]} title={STATUS_LABEL[dev]} aria-label={STATUS_LABEL[dev]} /> : null
      } },
    { key: 'name', title: 'Показатель', rowHeader: true, primary: true, get: (k) => k.name,
      render: (k) => {
        const { estimate } = readKpi(k, bundle, ctx)
        return <>{k.name}{estimate && <Chip size="sm" tone="idle" title="оценка по старому набору полей плана">оценка</Chip>}</>
      } },
    { key: 'value', title: 'Значение', num: true, get: (k) => k.value(bundle, ctx),
      render: (k) => kpiText(k.value(bundle, ctx), k.unit) },
    { key: 'dir', title: 'Лучше', width: 'fit', get: (k) => k.dir, className: 'an-td-dir',
      render: (k) => <span title={DIR_TITLE[k.dir]} aria-label={DIR_TITLE[k.dir]}>{DIR_ARROW[k.dir]} {k.dir === 'up' ? 'больше' : k.dir === 'down' ? 'меньше' : 'по контексту'}</span> },
    { key: 'info', title: <span className="dk-vh">Как считается</span>, sortable: false, width: 'fit', className: 'an-td-info',
      render: (k) => <InfoTip id={k.info} values={k.infoValues?.(bundle, ctx)} /> },
  ], [bundle, ctx])
  return (
    <DataTable<KpiDef> columns={columns} rows={KPI_CATALOG} rowKey={(k) => k.code} groupBy={(k) => k.category}
      rowTitle={(k) => `${k.nameEn} · ${k.formula}`} caption="Реестр KPI выбранного построения по категориям" tight width="content" />
  )
}

/* ── Сравнение с базой (по умолчанию — предыдущее построение) ───────────────── */
interface CompareRow { def: KpiDef; a: number; b: number }

interface PlanCompareProps {
  bundle: KpiBundle
  baseBundle: KpiBundle | null
  baseRef: PlanRef | null
  refs: ReadonlyArray<PlanRef>
  planId: string
  ctx: KpiContext
  onBase: (planId: string) => void
}

function PlanCompare({ bundle, baseBundle, baseRef, refs, planId, ctx, onBase }: PlanCompareProps) {
  const others = refs.filter((r) => r.id !== planId)
  const prev = previousPlan(refs, planId)
  const baseName = baseRef ? `${planNo(baseRef.seq)}${baseRef.id === prev?.id ? ' (предыдущее)' : ''}` : ''
  const rows = useMemo<CompareRow[]>(() => {
    if (!baseBundle?.kpi || Object.keys(baseBundle.kpi).length === 0) return []
    return COMPARE_CODES.map(kpiDef).filter((k): k is KpiDef => Boolean(k))
      .map((def) => ({ def, a: def.value(bundle, ctx), b: def.value(baseBundle, ctx) }))
  }, [bundle, baseBundle, ctx])

  const columns: DataColumn<CompareRow>[] = [
    { key: 'name', title: 'Показатель', rowHeader: true, primary: true, get: (r) => r.def.name },
    { key: 'a', title: 'Это построение', num: true, get: (r) => r.a, render: (r) => kpiText(r.a, r.def.unit) },
    { key: 'b', title: baseRef ? planNo(baseRef.seq) : 'База', num: true, get: (r) => r.b, render: (r) => kpiText(r.b, r.def.unit) },
    { key: 'd', title: 'Разница с базой', num: true, get: (r) => r.a - r.b,
      render: (r) => <DeltaChip value={r.a - r.b} better={deltaBetter(r.def.dir)} fmt={(x) => kpiDeltaText(x, r.def.unit)} /> },
  ]
  const tools = others.length > 0 && (
    <label className="an-tool an-tool--row">
      <span className="an-tool__k text-caps">База</span>
      <select className="dk-select" value={baseRef?.id ?? ''} onChange={(e) => onBase(e.target.value)} aria-label="База сравнения">
        {!baseRef && <option value="" disabled>— выберите построение —</option>}
        {others.map((r) => <option key={r.id} value={r.id}>{planOptionLabel(r)}{r.id === prev?.id ? ' · предыдущее' : ''}</option>)}
      </select>
    </label>
  )
  const title = <>Сравнение{baseName ? ` с ${baseName}` : ''} <InfoTip id="analytics.ab_delta" /></>
  return (
    <Section id="an-compare" title={title} tools={tools || undefined}>
      {others.length === 0 ? (
        <p className="an-muted">Сравнивать не с чем: это единственное построение. Постройте план ещё раз — здесь появится разница с ним.</p>
      ) : !baseRef ? (
        <p className="an-muted">Это самое раннее построение — выберите базу сравнения в списке «База».</p>
      ) : rows.length === 0 ? (
        <p className="an-muted">У {planNo(baseRef.seq)} нет сохранённых показателей — выберите другое построение в списке «База».</p>
      ) : (
        <DataTable<CompareRow> columns={columns} rows={rows} rowKey={(r) => r.def.code} tight framed width="content" caption={`Сравнение построения с ${baseName || 'базой'}`} />
      )}
    </Section>
  )
}
