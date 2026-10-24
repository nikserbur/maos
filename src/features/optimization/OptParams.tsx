/**
 * Параметры прогона «Портфеля» (X2 «ответ сначала», «честное происхождение»): после расчёта
 * карточка сворачивается в строку-сводку «Базовый · CVaR · α 10 % · 3 000 сценариев · доля ≤ 35 % ·
 * 12 мес ▸ Изменить параметры» (раскрыта сама, только когда результата нет или он устарел).
 * Происхождение — одной строкой «Все параметры — из сценария «…» ○»; бейдж у поля — только когда
 * значение переопределено для прогона («■ вручную · этот прогон · вернуть»). α и доля — в процентах
 * (в хранилище по-прежнему доли). Точная LP — только для CVaR и худшего случая, иначе причина рядом.
 * Кнопка запуска — primary, пока результата нет или он устарел; у свежего — вторичная «Пересчитать».
 */
import type { PriceScenario } from '../../lib/api'
import type { Provenance } from '../method-map/types'
import type { InfoTipValues } from '../../ui/InfoTip'
import { ParamField } from '../../ui/ParamField'
import { StateLegend } from '../../ui/StateLegend'
import { Segmented, Switch } from '../../ui/kit'
import { patchOptForm, type OptForm, type OptInherited } from './optStore'
import { DEFAULT_SAMPLES, paramsSummary } from './optText'
import { OBJECTIVES, lpApplies, type Objective } from './optTypes'

/** Доля → проценты для поля (хранилище не меняется): 0,1 → 10. */
const toPct = (share: string) => Math.round((Number(share) || 0) * 1000) / 10
const fromPct = (v: number) => String(Math.round(v * 10) / 1000)

interface RunControlProps {
  running: boolean
  hasResult: boolean
  /** Результата нет или он устарел — запуск становится главным действием. */
  primary: boolean
  onRun: () => void
}

function RunButton({ running, hasResult, primary, onRun }: RunControlProps) {
  return (
    <button type="button" className={`btn${primary ? ' btn--primary' : ''} opt2-run`} onClick={onRun} disabled={running} aria-busy={running || undefined}>
      {running ? 'Моделируем…' : hasResult ? 'Пересчитать' : 'Найти робастное решение'}
    </button>
  )
}

interface OptParamsProps extends RunControlProps {
  form: OptForm
  inherited: OptInherited | null
  scenarios: ReadonlyArray<PriceScenario>
  open: boolean
  onToggle: (open: boolean) => void
  onScenario: (id: string) => void
  /** Причина «устарело» словами или null. */
  staleText: string | null
  /** Живые значения «i» поля α (после расчёта). */
  alphaInfo?: InfoTipValues
}

export function OptParams(props: OptParamsProps) {
  const { form, inherited, scenarios, open, onToggle, onScenario, staleText, alphaInfo, ...run } = props
  const scenario = scenarios.find((s) => s.id === form.scenarioId)
  const months = Number(scenario?.months) || 12
  const stale = staleText && <span className="glyph-setup opt2-stale" role="status">устарело — {staleText}</span>

  if (!open) {
    return (
      <section className="dk-card opt2-summary dk-rise" aria-label="Параметры прогона">
        <span className="opt2-summary__text">{paramsSummary(form, scenario?.name)}</span>
        <button type="button" className="btn btn--ghost btn--sm" aria-expanded={false} aria-controls="opt-params" onClick={() => onToggle(true)}>
          ▸ Изменить параметры
        </button>
        {stale}
        <RunButton {...run} />
      </section>
    )
  }

  const o = {
    objective: Boolean(inherited) && form.objective !== inherited?.objective,
    alpha: Boolean(inherited) && Number(form.alpha) !== Number(inherited?.alpha),
    maxShare: Boolean(inherited) && Number(form.maxShare) !== Number(inherited?.maxShare),
    samples: Number(form.samples) !== DEFAULT_SAMPLES,
    horizon: Number(form.horizonMonths) !== months,
  }
  const overridden = Object.values(o).filter(Boolean).length
  /** Бейдж — только у переопределённого поля; неизменённые — одной строкой происхождения. */
  const passport = (changed: boolean, revert: () => void) => (changed
    ? { provenance: 'manual' as Provenance, owner: 'этот прогон', changed: true, onRevert: revert }
    : { provenance: 'default' as Provenance })
  const source = scenario ? `из сценария «${scenario.name}»` : 'по умолчанию — базовые цены НСИ'
  const lp = lpApplies(form.objective)
  const objHint = OBJECTIVES.find((x) => x.id === form.objective)?.hint ?? ''

  return (
    <section id="opt-params" tabIndex={-1} className="dk-card opt2-params dk-rise" aria-label="Параметры оптимизации">
      <div className="opt2-params__top">
        <p className="opt2-params__prov">
          <span className="mm-glyph mm-glyph--default" aria-hidden="true" />
          {overridden === 0 ? `Все параметры — ${source}` : `Остальные параметры — ${source}`}
          <StateLegend compact present={overridden ? ['default', 'manual'] : ['default']} />
        </p>
        {run.hasResult && (
          <button type="button" className="btn btn--ghost btn--sm" aria-expanded aria-controls="opt-params" onClick={() => onToggle(false)}>▾ Свернуть</button>
        )}
      </div>
      <div className="opt2-params__grid">
        <ParamField label="Сценарий внешних условий" value={null} size="md">
          <select className="dk-select" value={form.scenarioId} aria-label="Сценарий внешних условий" onChange={(e) => onScenario(e.target.value)}>
            {scenarios.length === 0 && <option value="">— базовые цены НСИ —</option>}
            {scenarios.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </ParamField>
        <ParamField label="Критерий" value={null} size="md" note={objHint}
          {...passport(o.objective, () => inherited && patchOptForm({ objective: inherited.objective }))}>
          <Segmented label="Критерий робастности" value={form.objective} onChange={(id: Objective) => patchOptForm({ objective: id })}
            options={OBJECTIVES.map((x) => ({ id: x.id, label: x.label, title: x.hint }))} />
        </ParamField>
        <ParamField label="α хвоста" value={toPct(form.alpha)} unit="%" size="md" info="opt.cvar" infoValues={alphaInfo} min={1} max={50} step={5}
          onChange={(v) => patchOptForm({ alpha: fromPct(v) })} {...passport(o.alpha, () => inherited && patchOptForm({ alpha: inherited.alpha }))} />
        <ParamField label="Число сценариев" value={Number(form.samples)} unit="шт" size="md" min={200} step={500}
          onChange={(v) => patchOptForm({ samples: String(v) })} {...passport(o.samples, () => patchOptForm({ samples: String(DEFAULT_SAMPLES) }))} />
        <ParamField label="Макс. доля изделия" value={toPct(form.maxShare)} unit="%" size="md" min={10} max={100} step={5}
          onChange={(v) => patchOptForm({ maxShare: fromPct(v) })} {...passport(o.maxShare, () => inherited && patchOptForm({ maxShare: inherited.maxShare }))} />
        <ParamField label="Горизонт" value={Number(form.horizonMonths)} unit="мес" size="md" min={1} max={36} step={1}
          onChange={(v) => patchOptForm({ horizonMonths: String(v) })} {...passport(o.horizon, () => patchOptForm({ horizonMonths: String(months) }))} />
      </div>
      <div className="opt2-params__row">
        <fieldset className="opt2-lp" disabled={!lp}>
          <legend className="dk-vh">Точная LP-модель</legend>
          <Switch checked={form.exact && lp} onChange={(v) => patchOptForm({ exact: v })}
            hint="Решить ту же задачу точно (LP Рокафеллара — Урясева, HiGHS) и показать разрыв с эвристикой">
            Сравнить с точной LP-моделью
          </Switch>
        </fieldset>
        {!lp && <span className="opt2-params__hint">LP — только для CVaR и худшего случая</span>}
        {stale}
        <RunButton {...run} />
      </div>
    </section>
  )
}
