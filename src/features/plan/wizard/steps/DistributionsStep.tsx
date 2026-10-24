/**
 * Шаг 3 «Распределения» [2] (UX-V2 §4.2; X2 «один экран на шаг»): одна колонка полей — вес хвоста
 * длительностей (переопределение прогона), индекс хвоста, разброс PERT, поломки; пояснения — в «i».
 * Распределения цен сценария и предпросмотр калибровки по план-факту — свёрнуты. Названия
 * распределений — словами (labels.ts); технические подробности — под «Подробнее».
 */
import { useState } from 'react'
import { api, type CalibRow } from '../../../../lib/api'
import { num, pct } from '../../../../explain/format'
import { fitLabel } from '../../../../explain/labels'
import { DensityMini } from '../../../../ui/DensityMini'
import { ParamField } from '../../../../ui/ParamField'
import { ProvenanceBadge } from '../../../../ui/ProvenanceBadge'
import { useRefs } from '../../../method-map/useMethodMapState'
import { usePassport } from '../../../passport/passportStore'
import { DataTable, InlineError, type DataColumn } from '../../../../ui/kit'
import type { WizardData } from '../useWizardData'
import { effectiveFields, isChanged, useWizard, wizardActions } from '../wizardStore'

const DIST_SHOWN = 8

const CALIB_COLS: DataColumn<CalibRow>[] = [
  { key: 'op', title: 'Операция', rowHeader: true, primary: true, get: (r) => r.op_name },
  { key: 'prod', title: 'Изделие', minWidth: 14, get: (r) => r.product_name },
  { key: 'norm', title: 'Норма, ч', num: true, get: (r) => r.t_norm, render: (r) => num(r.t_norm, 1) },
  { key: 'fact', title: 'Факт симуляции, ч', num: true, get: (r) => r.realized_mean, render: (r) => num(r.realized_mean, 1) },
  { key: 'n', title: 'Наблюдений', num: true, get: (r) => r.n, render: (r) => num(r.n, 0) },
  { key: 'd', title: 'Отклонение, %', num: true, get: (r) => r.delta_pct, render: (r) => `${r.delta_pct > 0 ? '+' : ''}${num(r.delta_pct, 1)}` },
]

export function DistributionsStep({ data }: { data: WizardData }) {
  const w = useWizard()
  const refs = useRefs()
  const passport = usePassport()
  const f = effectiveFields(w)
  const [calib, setCalib] = useState<{ rows: CalibRow[] } | null | 'loading' | { error: unknown }>(null)
  const tailDef = Number(passport.byCode['r1.03']?.value) || 0.08
  const tailIdx = passport.byCode['r1.04']?.value ?? '2.5'
  const dists = data.scenario?.distributions ?? []
  const nProd = refs.counts.sellable + refs.counts.purchased
  const withMtbf = refs.counts.wcTypesWithMtbf

  const preview = () => {
    setCalib('loading')
    api.simulation.calibration().then((r) => setCalib({ rows: r.rows })).catch((e: unknown) => setCalib({ error: e }))
  }

  return (
    <div className="wz-step">
      <div className="wz-fields wz-fields--one">
        <ParamField label="Доля операций с тяжёлым хвостом" value={(f.tailWeight ?? tailDef) * 100} unit="% операций" status={passport.byCode['r1.03']?.status ?? 'UI'}
          provenance={isChanged(w, 'tailWeight') ? 'manual' : 'ui'} owner={isChanged(w, 'tailWeight') ? 'этот прогон' : 'умолчание планировщика'}
          changed={isChanged(w, 'tailWeight')} onRevert={() => wizardActions.revert('tailWeight')}
          range={[0, 50]} step={1} min={0} max={50} onChange={(v) => wizardActions.setOverride('tailWeight', v / 100)} info="plan.makespan_cvar"
          hint="У этих операций длительность получает множитель Парето; остальные — логнормаль вокруг оценки PERT. Переопределение действует только на этот прогон и не пишется в справочники." />
        <ParamField label="Индекс хвоста α" value={String(tailIdx).replace('.', ',')} status={passport.byCode['r1.04']?.status ?? 'UI'} owner="задаётся в справочнике операций" readOnly
          hint="Не ниже 1,2; по операции может быть индивидуальным. Оценка по план-факту — после импорта факта." />
        <ParamField label="Разброс длительности без оценок разброса" value="0,15 · среднее" status={passport.byCode['r1.07']?.status ?? 'НОРМ'} owner="норматив" readOnly
          hint={`${num(refs.counts.operations, 0)} операций с нормами «оптимист · норма · пессимист»; переделка — с вероятностью ${String(passport.byCode['r1.02']?.value ?? '0,05').replace('.', ',')}.`} />
        <ParamField label="Поломки и ремонт" value={`${num(withMtbf, 0)} из ${num(refs.counts.wcTypes, 0)}`} unit="типов РЦ с наработкой на отказ" provenance={withMtbf > 0 ? 'manual' : 'default'} owner="справочник типов РЦ" readOnly
          hint="Интенсивность отказов растёт с износом; время ремонта — с разбросом. Наработку на отказ задают в справочнике типов РЦ."
          actions={<a className="pf-link" href="#/nsi/work_center_types">задать →</a>} />
      </div>

      <details className="wz-card wz-fold">
        <summary className="wz-card__t">
          Распределения цен сценария «{data.scenario?.name || 'сценарий без имени'}» · {num(dists.length, 0)} из {num(nProd, 0)} изделий
          {dists.length === 0 && <ProvenanceBadge status="НОРМ" title="По умолчанию: разброс 12 %, β = 0,7" />}
        </summary>
        {dists.length > 0 && (
          <div className="wz-dists">
            {dists.slice(0, DIST_SHOWN).map((d) => {
              const mean = Number(d.mean) || 0, sd = Number(d.stddev) || 0
              return (
                <div key={d.product_id} className="wz-dist">
                  <DensityMini type={d.dist_type} rel={mean > 0 ? sd / mean : 0.12} width={120} height={36} />
                  <span className="wz-dist__name">{data.products.find((p) => p.id === d.product_id)?.name ?? 'изделие'}</span>
                  <span className="wz-dist__meta">{fitLabel(d.dist_type)} · разброс {mean > 0 ? pct(sd / mean, 0) : '—'}</span>
                </div>
              )
            })}
            {dists.length > DIST_SHOWN && <span className="pl-note">… ещё {num(dists.length - DIST_SHOWN, 0)} · <a className="pf-link" href="#/scenarios/distributions">все в «Сценариях» →</a></span>}
          </div>
        )}
        <p className="pl-note">Цены влияют на кассу и портфель, не на порядок операций. <a className="pf-link" href="#/scenarios/distributions">Править в «Сценариях» →</a></p>
      </details>

      <details className="wz-card wz-fold">
        <summary className="wz-card__t">Сверка норм с план-фактом</summary>
        <p className="pl-note">Нормы калибруются только по настоящему план-факту: пока его нет, доступен предпросмотр по последней симуляции — он ничего не записывает.</p>
        <div className="wz-row">
          <button type="button" className="btn btn--sm" onClick={preview} aria-disabled={calib === 'loading'}>{calib === 'loading' ? 'Загружаем…' : 'Предпросмотр по симуляции'}</button>
          <details className="wz-more"><summary>Подробнее</summary><span className="mono">POST /api/simulation/calibrate → 409, пока таблица plan_fact_ops пуста (решение R20)</span></details>
        </div>
        {calib && typeof calib === 'object' && 'error' in calib && <InlineError error={calib.error} title="Предпросмотр недоступен" onRetry={preview} />}
        {calib && typeof calib === 'object' && 'rows' in calib && (
          <DataTable columns={CALIB_COLS} rows={calib.rows} rowKey={(r) => r.op_id} tight limit={DIST_SHOWN} empty="Нет данных симуляции для предпросмотра" caption="Предпросмотр калибровки норм" />
        )}
      </details>
    </div>
  )
}
