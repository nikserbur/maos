/**
 * Закреплённые показатели «Аналитики» (X1 §6.3 п. 3): число всегда `--text`, статус — глиф у
 * подписи + полоса снизу (`::after`), без hover-подъёма; герой (первая плитка) — 44 px и спарклайн
 * по построениям плана. Редактор набора — чипы по категориям, отдельно от плиток.
 */
import type { KpiBundle } from '../../lib/api'
import { Icon } from '../../shell/icons'
import { Sparkline } from '../../ui/charts'
import { ChoiceChip } from '../../ui/kit'
import { num } from '../../explain/format'
import { KPI_CATALOG, KPI_CATEGORIES, kpiDef, readKpi, type KpiContext } from './kpiCatalog'
import { DIR_ARROW, DIR_TITLE, STATUS_GLYPH, STATUS_LABEL, kpiParts, kpiStatus } from './kpiFormat'
import { kpiTrack } from './chartData'

interface KpiPinsProps {
  pinned: ReadonlyArray<string>
  /** KPI-блок, из которого берутся значения плиток (выбранный план или последний в ряду). */
  bundle: KpiBundle | null
  /** Ряд KPI по построениям — для спарклайна героя. */
  series: ReadonlyArray<KpiBundle>
  ctx: KpiContext
  onOpen: (code: string) => void
}

export function KpiPins({ pinned, bundle, series, ctx, onOpen }: KpiPinsProps) {
  if (pinned.length === 0) {
    return <p className="an-muted">Нет закреплённых показателей — нажмите «Настроить набор».</p>
  }
  const currentIdx = bundle ? series.findIndex((b) => b.plan_id === bundle.plan_id) : -1
  return (
    <div className="an-pins">
      {pinned.map((code, i) => {
        const def = kpiDef(code)
        if (!def) return null
        const { value, estimate } = bundle ? readKpi(def, bundle, ctx) : { value: Number.NaN, estimate: false }
        const st = bundle ? kpiStatus(def, value, bundle) : ''
        const parts = kpiParts(value, def.unit)
        const hero = i === 0
        const track = hero ? kpiTrack(code, series) : []
        const cls = ['an-pin', hero ? 'an-pin--hero' : '', st ? `an-pin--${st}` : ''].filter(Boolean).join(' ')
        return (
          <button key={code} type="button" className={cls} onClick={() => onOpen(code)} title={`${def.nameEn} — показать по построениям`}>
            <span className="an-pin__k text-caps">
              {st && <span className={STATUS_GLYPH[st]} title={STATUS_LABEL[st]} aria-label={STATUS_LABEL[st]} />}
              {def.name}
              <span className="an-pin__dir" title={DIR_TITLE[def.dir]} aria-label={DIR_TITLE[def.dir]}>{DIR_ARROW[def.dir]}</span>
            </span>
            <span className="an-pin__v">
              {estimate && <span className="an-pin__est" title="оценка по старому набору полей плана">≈</span>}
              {parts.value}
              {parts.unit && <small>{parts.unit}</small>}
            </span>
            {hero && track.filter(Number.isFinite).length >= 2 && (
              <span className="an-pin__trend">
                <Sparkline points={track} width={220} height={36} mark={currentIdx >= 0 ? currentIdx : undefined} />
                <span className="an-pin__trend-k">по {num(track.length, 0)} построениям</span>
              </span>
            )}
          </button>
        )
      })}
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
                    {k.name}
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
