/**
 * Разбор KPI выбранного плана (X1 §6.3 п. 4): рекомендации с количественным обоснованием,
 * сравнение с другим построением и реестр показателей таблицей — группы каталога как липкие
 * подзаголовки, значение `--text` вправо, направление «↑/↓», формула — через «i», не в открытую.
 */
import { useEffect, useMemo, useState } from 'react'
import { api, type KpiBundle, type SimPlanSummary } from '../../lib/api'
import { Icon } from '../../shell/icons'
import { InfoTip } from '../../ui/InfoTip'
import { Chip, DataTable, IconButton, Section, type DataColumn } from '../../ui/kit'
import { num } from '../../explain/format'
import { KPI_CATALOG, readKpi, type KpiContext, type KpiDef } from './kpiCatalog'
import { DIR_ARROW, DIR_TITLE, STATUS_GLYPH, STATUS_LABEL, isBetter, kpiDeltaText, kpiStatus, kpiText } from './kpiFormat'
import { buildRecommendations, type TypeLoad } from './analyticsModel'
import { shortDate } from './chartData'

const COMPARE_CODES = ['MAKESPAN', 'OTD', 'TARD', 'UTIL', 'THRU', 'COST']

interface KpiRegistryProps {
  /** KPI-блок плана с «влитыми» полями кассы. */
  bundle: KpiBundle
  loads: ReadonlyArray<TypeLoad>
  plans: ReadonlyArray<SimPlanSummary>
  planId: string
  ctx: KpiContext
  /** Подпись источника денежных KPI (водопад кассы) для меты реестра. */
  cashNote: string
  onInvest: (wcTypeId: string) => void
}

export function KpiRegistry({ bundle, loads, plans, planId, ctx, cashNote, onInvest }: KpiRegistryProps) {
  const recs = useMemo(() => buildRecommendations(bundle, loads, ctx), [bundle, loads, ctx])
  return (
    <>
      {recs.length > 0 && (
        <section className="dk-card an-recs dk-rise" aria-label="Рекомендации">
          <div className="dk-card__head">
            <h2 className="dk-card__title"><Icon name="bulb" size={15} />Что улучшить</h2>
            <span className="dk-card__meta">правила поддержки решений <InfoTip id="analytics.recommendations" /></span>
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

      {plans.length > 1 && <PlanCompare bundle={bundle} plans={plans} planId={planId} />}

      <Section id="an-registry" title="Реестр показателей"
        meta={<>{num(KPI_CATALOG.length, 0)} показателей · значения из сохранённого блока плана · {cashNote}</>}>
        <RegistryTable bundle={bundle} ctx={ctx} />
      </Section>
    </>
  )
}

/* ── Реестр: таблица с группами каталога ───────────────────────────────────── */
function RegistryTable({ bundle, ctx }: { bundle: KpiBundle; ctx: KpiContext }) {
  const columns = useMemo<DataColumn<KpiDef>[]>(() => [
    { key: 'status', title: <span className="dk-vh">Статус</span>, sortable: false, className: 'an-td-status',
      render: (k) => {
        const st = kpiStatus(k, k.value(bundle, ctx), bundle)
        return st ? <span className={STATUS_GLYPH[st]} title={STATUS_LABEL[st]} aria-label={STATUS_LABEL[st]} /> : null
      } },
    { key: 'name', title: 'Показатель', rowHeader: true, get: (k) => k.name,
      render: (k) => {
        const { estimate } = readKpi(k, bundle, ctx)
        return <>{k.name}{estimate && <Chip size="sm" tone="idle" title="оценка по старому набору полей плана">оценка</Chip>}</>
      } },
    { key: 'value', title: 'Значение', num: true, get: (k) => k.value(bundle, ctx),
      render: (k) => kpiText(k.value(bundle, ctx), k.unit) },
    { key: 'dir', title: 'Лучше', get: (k) => k.dir, className: 'an-td-dir',
      render: (k) => <span title={DIR_TITLE[k.dir]} aria-label={DIR_TITLE[k.dir]}>{DIR_ARROW[k.dir]} {k.dir === 'up' ? 'больше' : k.dir === 'down' ? 'меньше' : 'по контексту'}</span> },
    { key: 'info', title: <span className="dk-vh">Как считается</span>, sortable: false, className: 'an-td-info',
      render: (k) => <InfoTip id={k.info} values={k.infoValues?.(bundle, ctx)} /> },
  ], [bundle, ctx])
  return (
    <DataTable<KpiDef>
      columns={columns}
      rows={KPI_CATALOG}
      rowKey={(k) => k.code}
      groupBy={(k) => k.category}
      rowTitle={(k) => `${k.nameEn} · ${k.formula}`}
      caption="Реестр KPI выбранного плана по категориям"
      tight
    />
  )
}

/* ── Сравнение с другим построением (A/B) ──────────────────────────────────── */
interface CompareRow { def: KpiDef; a: number; b: number }

function PlanCompare({ bundle, plans, planId }: { bundle: KpiBundle; plans: ReadonlyArray<SimPlanSummary>; planId: string }) {
  const [cmpId, setCmpId] = useState('')
  const [cmp, setCmp] = useState<KpiBundle | null>(null)
  useEffect(() => {
    if (!cmpId) { setCmp(null); return }
    let alive = true
    api.analytics.kpi(cmpId).then((b) => { if (alive) setCmp(b) }).catch(() => { if (alive) setCmp(null) })
    return () => { alive = false }
  }, [cmpId])

  const rows = useMemo<CompareRow[]>(() => {
    if (!cmp?.kpi || Object.keys(cmp.kpi).length === 0) return []
    return COMPARE_CODES
      .map((code) => KPI_CATALOG.find((k) => k.code === code))
      .filter((k): k is KpiDef => Boolean(k))
      .map((def) => ({ def, a: def.value(bundle), b: def.value(cmp) }))
  }, [bundle, cmp])

  const columns: DataColumn<CompareRow>[] = [
    { key: 'name', title: 'Показатель', rowHeader: true, get: (r) => r.def.name },
    { key: 'a', title: 'Этот план', num: true, get: (r) => r.a, render: (r) => kpiText(r.a, r.def.unit) },
    { key: 'b', title: 'Второй план', num: true, get: (r) => r.b, render: (r) => kpiText(r.b, r.def.unit) },
    { key: 'd', title: 'Разница', num: true, get: (r) => r.a - r.b,
      render: (r) => {
        const d = r.a - r.b
        const better = isBetter(d, r.def.dir)
        const text = kpiDeltaText(d, r.def.unit)
        return better === null ? text : <Chip size="sm" tone={better ? 'good' : 'bad'}>{text}</Chip>
      } },
  ]
  const others = plans.filter((p) => p.id !== planId)
  const tools = (
    <label className="an-tool">
      <span className="an-tool__k text-caps">Сравнить с</span>
      <select className="dk-select" value={cmpId} onChange={(e) => setCmpId(e.target.value)}>
        <option value="">— второй план —</option>
        {others.map((p) => {
          const n = plans.length - plans.indexOf(p)
          return <option key={p.id} value={p.id}>#{n} · {shortDate(p.created_at)}</option>
        })}
      </select>
    </label>
  )
  return (
    <Section id="an-compare" title="Сравнение построений" meta="разница по ключевым показателям; ● лучше · ■ хуже с учётом направления" tools={tools}>
      {rows.length > 0 && <DataTable<CompareRow> columns={columns} rows={rows} rowKey={(r) => r.def.code} tight framed caption="Сравнение двух построений плана" />}
    </Section>
  )
}
