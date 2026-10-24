/**
 * Закреплённые показатели «Аналитики» — плитки кита (KpiTile), как на «Плане»: та же подпись
 * («Заказы в срок · OTD»), «i» из реестра, число текстовым цветом, Δ к названной базе («−18 ч к №27»).
 * Отклонение — глиф и слово; норма не подписывается и не красится. Герой — длина расписания с
 * полосой хвоста (дет. · E · CVaR · худший) и спарклайном по построениям; ряд спарклайна держит
 * место скелетом, пока ряд грузится. Редактор набора — чипы по категориям, отдельно от плиток.
 */
import type { KpiBundle } from '../../lib/api'
import { Icon } from '../../shell/icons'
import { Sparkline } from '../../ui/charts'
import { ChoiceChip, IconButton, KpiTile, Skeleton, TailStrip } from '../../ui/kit'
import { countText } from '../../explain/format'
import { KPI_CATALOG, KPI_CATEGORIES, kpiDef, kpiField, kpiLabel, readKpi, type KpiContext, type KpiDef } from './kpiCatalog'
import { STATUS_LABEL, deltaBetter, kpiDeltaText, kpiDeviation, kpiText } from './kpiFormat'
import { kpiTrack } from './chartData'
import { planNo, type PlanRef } from './planRuns'

const DEV_GLYPH = { warn: 'glyph-setup', bad: 'glyph-down' } as const
const BUILDS = ['построению', 'построениям', 'построениям'] as const

interface KpiPinsProps {
  pinned: ReadonlyArray<string>
  /** KPI-блок выбранного построения (с полями кассы); null — нет данных. */
  bundle: KpiBundle | null
  loading: boolean
  /** Ряд KPI по построениям до выбранного включительно, в окне периода — для спарклайна героя. */
  series: ReadonlyArray<KpiBundle>
  seriesLoading: boolean
  ctx: KpiContext
  /** База Δ: предыдущее построение (или выбранное в сравнении). */
  base: { ref: PlanRef; bundle: KpiBundle } | null
  onOpen: (code: string) => void
  editing: boolean
  onToggleEdit: () => void
}

export function KpiPins({ pinned, bundle, loading, series, seriesLoading, ctx, base, onOpen, editing, onToggleEdit }: KpiPinsProps) {
  const defs = pinned.map(kpiDef).filter((d): d is KpiDef => Boolean(d))
  return (
    <div className="an-pins" aria-label="Закреплённые показатели" role="group">
      {defs.map((def, i) => (
        loading || !bundle
          ? <PinSkeleton key={def.code} hero={i === 0} label={kpiLabel(def)} />
          : <Pin key={def.code} def={def} hero={i === 0} bundle={bundle} series={series} seriesLoading={seriesLoading} ctx={ctx} base={base} onOpen={onOpen} />
      ))}
      <button type="button" className="an-pin-add" aria-pressed={editing} onClick={onToggleEdit}>
        <Icon name={editing ? 'check' : 'pin'} size={14} />
        {editing ? 'Готово' : defs.length ? 'Настроить набор' : 'Закрепить показатели'}
      </button>
    </div>
  )
}

interface PinProps {
  def: KpiDef
  hero: boolean
  bundle: KpiBundle
  series: ReadonlyArray<KpiBundle>
  seriesLoading: boolean
  ctx: KpiContext
  base: KpiPinsProps['base']
  onOpen: (code: string) => void
}

function Pin({ def, hero, bundle, series, seriesLoading, ctx, base, onOpen }: PinProps) {
  const label = kpiLabel(def)
  const { value, estimate } = readKpi(def, bundle, ctx)
  const dev = kpiDeviation(def, value, bundle)
  const baseValue = base ? def.value(base.bundle, ctx) : Number.NaN
  const d = value - baseValue
  const showDelta = base && Number.isFinite(d) && (hero || Math.abs(d) > 1e-12)
  const tools = (
    <span className="an-pin__tools">
      {estimate && <span className="an-pin__est" title="оценка по старому набору полей плана">≈ оценка</span>}
      <IconButton icon="chart" size="sm" variant="ghost" title={`«${label}» по построениям — в первом графике`} onClick={() => onOpen(def.code)} />
    </span>
  )
  return (
    <KpiTile metric={def.info} values={def.infoValues?.(bundle, ctx)} label={label} value={kpiText(value, def.unit)}
      size={hero ? 'hero' : 'md'} className={`an-pin${hero ? ' an-pin--hero' : ''}`} status={tools}
      state={dev ? { glyph: DEV_GLYPH[dev], word: STATUS_LABEL[dev] } : undefined}
      delta={showDelta && base ? { value: d, better: deltaBetter(def.dir), base: planNo(base.ref.seq), fmt: (x) => kpiDeltaText(x, def.unit) } : undefined}>
      {hero && <HeroExtras def={def} bundle={bundle} series={series} seriesLoading={seriesLoading} />}
    </KpiTile>
  )
}

/** Герой: полоса хвоста (для длины расписания) и спарклайн; место под спарклайн держится всегда. */
function HeroExtras({ def, bundle, series, seriesLoading }: { def: KpiDef; bundle: KpiBundle; series: ReadonlyArray<KpiBundle>; seriesLoading: boolean }) {
  const det = kpiField(bundle, 'makespan')
  const mean = kpiField(bundle, 'makespan_mean')
  const cvar = kpiField(bundle, 'makespan_cvar')
  const worst = kpiField(bundle, 'makespan_worst')
  const tail = def.code === 'MAKESPAN' && [det, mean, cvar, worst].every(Number.isFinite)
  const track = kpiTrack(def.code, series)
  const points = track.filter(Number.isFinite).length
  return (
    <>
      {tail && <TailStrip det={det} mean={mean} cvar={cvar} worst={worst} />}
      <div className="an-pin__trend">
        {seriesLoading ? <Skeleton h={36} w={220} /> : points >= 2 ? (
          <>
            <Sparkline points={track} width={220} height={36} mark={track.length - 1} />
            <span className="an-pin__trend-k">по {countText(points, BUILDS)}</span>
          </>
        ) : (
          <span className="an-pin__trend-k">тренд появится со второго построения</span>
        )}
      </div>
    </>
  )
}

function PinSkeleton({ hero, label }: { hero: boolean; label: string }) {
  return (
    <div className={`dk-kpitile an-pin${hero ? ' an-pin--hero' : ''}`} aria-busy="true" aria-label={`${label}: загрузка`}>
      <Skeleton h={11} w="60%" />
      <Skeleton h={hero ? 32 : 24} w="45%" />
      {hero && <Skeleton h={36} w={220} />}
    </div>
  )
}

/* ── Редактор набора закреплённых KPI (чипы по категориям) ──────────────────── */
export function PinEditor({ pinned, onToggle }: { pinned: ReadonlyArray<string>; onToggle: (code: string) => void }) {
  return (
    <div className="an-pin-editor dk-rise" role="group" aria-label="Набор закреплённых показателей">
      {KPI_CATEGORIES.map((cat) => {
        const items = KPI_CATALOG.filter((k) => k.category === cat)
        if (!items.length) return null
        return (
          <div key={cat} className="an-pin-cat">
            <span className="an-pin-cat__t text-caps">{cat}</span>
            <div className="an-pin-cat__chips">
              {items.map((k) => {
                const on = pinned.includes(k.code)
                return (
                  <ChoiceChip key={k.code} pressed={on} onToggle={() => onToggle(k.code)}>
                    <Icon name={on ? 'check' : 'plus'} size={12} />
                    {kpiLabel(k)}
                  </ChoiceChip>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
