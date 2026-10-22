/**
 * Шаг 3 «Распределения» [2] (UX-V2 §4.2): хвосты длительностей (`tail_weight` — переопределение
 * прогона с паспортом r1.03, `tail_index` — паспорт r1.04), PERT σ (норматив r1.07), поломки
 * (MTBF по типам РЦ), распределения цен сценария. «Оценить по план-факту» — честно: R20 блокирует
 * калибровку без plan_fact_ops; предпросмотр (`GET /api/simulation/calibration`) показывается.
 */
import { useState } from 'react'
import { api, type CalibRow } from '../../../../lib/api'
import { num, pct } from '../../../../explain/format'
import { DensityMini } from '../../../../ui/DensityMini'
import { ParamField } from '../../../../ui/ParamField'
import { useRefs } from '../../../method-map/useMethodMapState'
import { usePassport } from '../../../passport/passportStore'
import { Chip } from '../../../../ui/kit'
import type { WizardData } from '../useWizardData'
import { effectiveFields, isChanged, useWizard, wizardActions } from '../wizardStore'

export function DistributionsStep({ data }: { data: WizardData }) {
  const w = useWizard()
  const refs = useRefs()
  const passport = usePassport()
  const f = effectiveFields(w)
  const [calib, setCalib] = useState<{ rows: CalibRow[]; planId: string | null } | null | 'loading' | 'error'>(null)
  const tailDef = Number(passport.byCode['r1.03']?.value) || 0.08
  const tailIdx = passport.byCode['r1.04']?.value ?? '2.5'
  const dists = data.scenario?.distributions ?? []
  const nProd = refs.counts.sellable + refs.counts.purchased
  const withMtbf = refs.counts.wcTypesWithMtbf

  const preview = () => {
    setCalib('loading')
    api.simulation.calibration().then((r) => setCalib({ rows: r.rows, planId: r.plan_id })).catch(() => setCalib('error'))
  }

  return (
    <div className="wz-step">
      <div className="wz-fields">
        <ParamField label="Вес хвоста Парето · tail_weight" value={f.tailWeight ?? tailDef} unit="доля операций" status={passport.byCode['r1.03']?.status ?? 'UI'}
          provenance={isChanged(w, 'tailWeight') ? 'manual' : 'ui'} owner={isChanged(w, 'tailWeight') ? 'этот прогон' : 'умолчание планировщика (r1.03)'}
          changed={isChanged(w, 'tailWeight')} onRevert={() => wizardActions.revert('tailWeight')}
          range={[0, 0.5]} step={0.01} min={0} max={0.5} slider onChange={(v) => wizardActions.setOverride('tailWeight', v)}
          info="plan.makespan_cvar" note={<>Доля операций, у которых длительность получает множитель Парето 1 + min(8, F − 1); остальные — логнормаль вокруг PERT. Переопределение действует только на этот прогон (■ manual) и не пишется в НСИ.{' '}{passport.byCode['r1.03']?.source && <>Цель паспорта: {passport.byCode['r1.03'].source}.</>}</>} />
        <ParamField label="Индекс хвоста α · tail_index" value={String(tailIdx)} status={passport.byCode['r1.04']?.status ?? 'UI'} owner="паспорт r1.04 · задаётся в НСИ операций" readOnly
          note="Нижняя граница ≥ 1,2; по операции может быть индивидуальным. Оценка Хилла/GPD по план-факту — после импорта факта (R20)." />
        <ParamField label="PERT: σ при t_opt = t_pess" value="0,15 · mean" status={passport.byCode['r1.07']?.status ?? 'НОРМ'} owner="норматив r1.07" readOnly
          note={`${num(refs.counts.operations, 0)} операций с нормами t_opt / t_norm / t_pess; переделка с вероятностью risk_coef ${passport.byCode['r1.02']?.value ?? '0,05'} [НОРМ].`} />
        <ParamField label="Поломки и ремонт · MTBF" value={`${withMtbf} из ${refs.counts.wcTypes}`} unit="типов РЦ" provenance={withMtbf > 0 ? 'manual' : 'default'} owner="НСИ типов РЦ" readOnly
          note={<>Интенсивность отказов λ = (0,5 + 1,5u)/MTBF [{passport.byCode['r1.12']?.status ?? 'UI'}], CV ремонта {passport.byCode['r1.13']?.value ?? '0,6'} [НОРМ]. <a className="pf-link" href="#/nsi/work_center_types">задать MTBF →</a></>} />
      </div>

      <section className="wz-card" aria-label="Распределения цен сценария">
        <div className="wz-card__head">
          <p className="wz-card__t">Распределения цен сценария «{data.scenario?.name ?? '—'}» · {dists.length} из {nProd} изделий</p>
          <span className="wz-badges">
            {dists.length === 0 ? <Chip tone="warn">по умолчанию: σ = 12 % · β = 0,7 [UI/НОРМ]</Chip> : <Chip>задано {dists.length}</Chip>}
            <a className="pf-link" href="#/scenarios/distributions">править в «Сценариях» →</a>
          </span>
        </div>
        {dists.length > 0 && (
          <div className="wz-dists">
            {dists.slice(0, 8).map((d) => {
              const mean = Number(d.mean) || 0, sd = Number(d.stddev) || 0
              return (
                <div key={d.product_id} className="wz-dist">
                  <DensityMini type={d.dist_type} rel={mean > 0 ? sd / mean : 0.12} width={120} height={36} />
                  <span className="wz-dist__name">{data.products.find((p) => p.id === d.product_id)?.name ?? d.product_id}</span>
                  <span className="wz-dist__meta mono">{d.dist_type} · σ {mean > 0 ? pct(sd / mean, 0) : '—'} · β {d.beta ?? '0,7'}</span>
                </div>
              )
            })}
            {dists.length > 8 && <span className="pl-note">… ещё {dists.length - 8}</span>}
          </div>
        )}
        <p className="pl-note">Цены влияют на кассу и портфель, не на порядок операций; на этом шаге они показаны, чтобы видеть унаследованное.</p>
      </section>

      <section className="wz-card" aria-label="Оценка по план-факту">
        <div className="wz-card__head">
          <p className="wz-card__t">Оценить по план-факту (калибровка норм, R20)</p>
          <button type="button" className="btn" onClick={preview} disabled={calib === 'loading'}>{calib === 'loading' ? 'Загружаем…' : 'Предпросмотр калибровки'}</button>
        </div>
        <p className="pl-note">
          <b>Оценка недоступна без план-факта:</b> `POST /api/simulation/calibrate` отвечает 409, пока таблица `plan_fact_ops` (synthetic = 0) пуста —
          нормы не калибруются по синтетической симуляции (решение Р7/R20). Предпросмотр по последней симуляции показывается, но в НСИ не пишется.
        </p>
        {calib === 'error' && <p className="pl-note pl-note--danger">Предпросмотр недоступен.</p>}
        {calib && calib !== 'loading' && calib !== 'error' && (
          calib.rows.length === 0 ? <p className="pl-note">Нет данных симуляции для предпросмотра.</p> : (
            <table className="plan__rules">
              <thead><tr><th>Операция</th><th>Изделие</th><th>Норма</th><th>Факт (симуляция)</th><th>n</th><th>Δ</th></tr></thead>
              <tbody>
                {calib.rows.slice(0, 8).map((r) => (
                  <tr key={r.op_id}><td>{r.op_name}</td><td>{r.product_name}</td><td className="num">{num(r.t_norm, 1)}</td><td className="num">{num(r.realized_mean, 1)}</td><td className="num">{r.n}</td><td className="num">{r.delta_pct >= 0 ? '+' : ''}{num(r.delta_pct, 1)} %</td></tr>
                ))}
              </tbody>
            </table>
          )
        )}
      </section>
    </div>
  )
}
