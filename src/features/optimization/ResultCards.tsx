/**
 * Вторичные карточки результата «Портфеля»: проверка вне выборки (вердикт учитывает направление,
 * порог 5 %), сравнение эвристики с точной LP (разрыв словами «LP лучше на …», теневые цены — таблица
 * кита), граница Парето и загрузка оборудования с заголовками-утверждениями и линией порога 80 %.
 * Только представление: числа те же, что прислал сервер.
 */
import { lpStatusLabel, objectiveLabel } from '../../explain/labels'
import { money, num, pct } from '../../explain/format'
import { InfoTip } from '../../ui/InfoTip'
import { BarList, Meter } from '../../ui/charts'
import { CapsLabel, Chip, DataTable, rise, type DataColumn } from '../../ui/kit'
import type { OptExactDual, OptResultExt } from './optTypes'
import { ParetoFrontier } from './ParetoFrontier'
import { exactValues, loadValues, oosValues, paretoValues } from './optTips'
import { HOT_LOAD, OOS_GAP, exactGapView, loadTitle, oosCvarText, oosExpectedText, oosWorse, paretoTitle } from './optText'
import { kpiLabels } from './optTypes'

/** Загрузка: первые 8 типов + «Все N». */
const LOAD_TOP = 8
/** Теневые цены: первые 8 строк + «Показать все». */
const DUALS_TOP = 8

/* ── Проверка вне выборки ─────────────────────────────────────────────────── */
export function OosCard({ result }: { result: OptResultExt }) {
  const o = result.oos
  if (!o) return null
  const worse = oosWorse(o)
  const L = kpiLabels(result.alpha)
  return (
    <section className="dk-card dk-rise" style={rise(4)} aria-labelledby="opt-oos-title">
      <div className="dk-card__head">
        <h3 className="dk-card__title" id="opt-oos-title">
          Проверка вне выборки<InfoTip id="opt.oos_gap" values={oosValues(result)['opt.oos_gap']} />
        </h3>
        <span title={`порог: хуже на ${pct(OOS_GAP, 0)}`}>
          {worse
            ? <Chip size="sm"><span className="glyph-setup" aria-hidden="true" />вне выборки хуже</Chip>
            : <Chip size="sm"><span className="glyph-running" aria-hidden="true" />вне выборки не хуже</Chip>}
        </span>
      </div>
      <p className="opt-note">Тот же портфель на {num(result.samples, 0)} новых сценариях (другое зерно генератора).</p>
      <div className="opt-drows">
        <div className="opt-drow opt-drow--2">
          <span className="opt-drow__label">{L.expected}</span>
          <span className="opt-drow__value num">{money(o.expected)} · <span className="opt-drow__word">{oosExpectedText(o.gap_expected)}</span></span>
        </div>
        <div className="opt-drow opt-drow--2">
          <span className="opt-drow__label"><CapsLabel text={L.cvar} /></span>
          <span className="opt-drow__value num">{money(o.cvar)} · <span className="opt-drow__word">{oosCvarText(o.gap_cvar)}</span></span>
        </div>
      </div>
    </section>
  )
}

/* ── Эвристика ↔ точная LP-модель ─────────────────────────────────────────── */
function GapValue({ label, v }: { label: string; v: number | null | undefined }) {
  const g = exactGapView(v)
  return (
    <div className="dk-kpi">
      <span className="dk-kpi__label opt-eyebrow">{label}</span>
      <span className="dk-kpi__value dk-kpi__value--md opt-gap">
        {g.glyph && <span className={`opt-gap__glyph opt-gap__glyph--${g.tone}`} aria-hidden="true">{g.glyph}</span>}
        {g.text}
      </span>
    </div>
  )
}

const DUAL_COLUMNS = (nameOf: (id: string) => string, maxPrice: number): ReadonlyArray<DataColumn<OptExactDual>> => [
  { key: 'wc_type', title: 'Тип оборудования', rowHeader: true, clip: true, get: (d) => nameOf(d.wc_type), render: (d) => nameOf(d.wc_type) },
  {
    key: 'shadow_price', title: 'Теневая цена, ₽/ч', num: true,
    render: (d) => (
      <span className="opt-pf__money">
        <Meter value={d.shadow_price} max={maxPrice} tone="accent" className="opt-pf__bar" />
        <span>{num(d.shadow_price, 0)}</span>
      </span>
    ),
  },
  { key: 'utilization', title: 'Загрузка, %', num: true, render: (d) => num(d.utilization * 100, 0) },
]

export function ExactCard({ result, nameOf }: { result: OptResultExt; nameOf: (id: string) => string }) {
  const ex = result.exact
  if (!ex) return null
  if (ex.status !== 'optimal') {
    return (
      <section className="dk-card opt2-span-12 dk-rise" style={rise(5)} aria-labelledby="opt-exact-title">
        <h3 className="dk-card__title" id="opt-exact-title">
          {ex.status === 'not_applicable'
            ? `Точная модель (LP, HiGHS) не применяется к критерию «${objectiveLabel(result.objective)}»`
            : `Точная модель (LP, HiGHS): ${lpStatusLabel(ex.status, 'long')}`}
        </h3>
        <p className="opt-note">
          {ex.reason ? `${ex.reason}. ` : ''}Для критериев «{objectiveLabel('meanvariance')}» и «{objectiveLabel('minregret')}» точная
          LP-постановка не применяется.
        </p>
      </section>
    )
  }
  const g = ex.gap_vs_heuristic ?? {}
  const duals = (ex.duals ?? []).filter((d) => d.shadow_price > 0)
  const maxPrice = Math.max(1, ...duals.map((d) => d.shadow_price))
  return (
    <section className="dk-card opt2-span-12 dk-rise" style={rise(5)} aria-labelledby="opt-exact-title">
      <div className="dk-card__head">
        <div>
          <p className="text-caps opt-eyebrow">Эвристика ↔ точная модель</p>
          <h3 className="dk-card__title" id="opt-exact-title">
            Точное решение: LP Рокафеллара — Урясева (HiGHS)<InfoTip id="opt.exact_gap" values={exactValues(result)['opt.exact_gap']} />
          </h3>
        </div>
        <Chip size="sm"><span className="glyph-running" aria-hidden="true" />{lpStatusLabel('optimal', 'long')}</Chip>
      </div>
      <p className="opt-note">
        Те же {num(ex.n_scenarios ?? result.samples, 0)} сценариев (общие случайные числа), вогнутая выручка — кусочно-линейно
        (отрезков: {num(ex.pwl_segments, 0)}, ошибка ≤ {money(ex.pwl_max_error ?? 0)}). Решено за {num(ex.solve_ms ?? 0, 0)} мс.
      </p>
      <div className="opt2-exact__grid">
        <GapValue label="По цели критерия" v={g.objective_pct} />
        <GapValue label="Вне выборки" v={g.oos_objective_pct} />
        <GapValue label="Ожидаемая прибыль E" v={g.expected_pct} />
        <GapValue label="CVaR" v={g.cvar_pct} />
      </div>
      {duals.length > 0 && (
        <>
          <p className="opt-subhead">Теневые цены мощностей — сколько прибыли дал бы ещё один час работы типа оборудования</p>
          <DataTable columns={DUAL_COLUMNS(nameOf, maxPrice)} rows={duals} rowKey={(d) => d.wc_type} tight limit={DUALS_TOP}
            defaultSort={{ key: 'shadow_price', dir: 'desc' }} caption="Теневые цены мощностей" />
        </>
      )}
    </section>
  )
}

/* ── Граница Парето и загрузка оборудования ──────────────────────────────── */
export function ParetoCard({ result }: { result: OptResultExt }) {
  if (!(result.candidates?.length > 1)) return null
  const t = paretoTitle(result.candidates)
  return (
    <section className="dk-card opt2-span-6 opt2-chartcard dk-rise" style={rise(6)} aria-labelledby="opt-pareto-title">
      <div className="dk-card__head">
        <h3 className="dk-card__title" id="opt-pareto-title">{t.title}</h3>
        <span className="dk-card__meta">{t.meta}<InfoTip id="opt.pareto" values={paretoValues(result)['opt.pareto']} /></span>
      </div>
      <ParetoFrontier candidates={result.candidates} alpha={result.alpha} />
    </section>
  )
}

export function LoadCard({ result, nameOf }: { result: OptResultExt; nameOf: (id: string) => string }) {
  const rows = [...result.robust.resource_load].sort((a, b) => b.utilization - a.utilization)
  return (
    <section className="dk-card opt2-span-6 opt2-chartcard opt-load dk-rise" style={rise(7)} aria-labelledby="opt-load-title">
      <div className="dk-card__head">
        <h3 className="dk-card__title" id="opt-load-title">
          {loadTitle(rows, nameOf)}<InfoTip id="opt.resource_load" values={loadValues(result.robust)['opt.resource_load']} />
        </h3>
      </div>
      {rows.length === 0 ? <p className="opt-note">Нет загрузки.</p> : (
        <BarList compact fmt={(v) => pct(v, 0)} max={1} valueHeader="Загрузка" limit={LOAD_TOP}
          mark={{ value: HOT_LOAD, label: 'близко к пределу' }}
          ariaLabel={`Загрузка ${rows.length} типов оборудования портфелем: от ${pct(rows[0].utilization, 0)} до ${pct(rows[rows.length - 1].utilization, 0)}`}
          rows={rows.map((l) => ({
            key: l.wc_type_id, label: nameOf(l.wc_type_id), labelText: nameOf(l.wc_type_id), value: Math.min(1, l.utilization), marked: l.utilization >= HOT_LOAD,
            secondary: l.utilization >= HOT_LOAD ? <span className="glyph-setup">близко к пределу</span> : undefined,
          }))} />
      )}
    </section>
  )
}
