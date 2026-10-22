/**
 * Карточка «Финансовые ограничения» (UX-V2 §4.4 п. 1, решение владельца §8 п. 5 — видна уже в G2):
 * касса на старте, кредитная линия (лимит / спред), DSO-ядро, DPO, PD, бюджет ремонтов, НДС и
 * налог на прибыль — из `GET /api/fin_params` с бейджами серверного паспорта ([К] / [НОРМ]).
 * Правки — локальный черновик; «Сохранить в проект» = явный `PUT /api/fin_params`. Параметры
 * прогона (L_min, β) — переопределения мастера, в проект не пишутся.
 */
import { useEffect, useState } from 'react'
import type { FinParams } from '../../../../lib/api'
import { money, num, pct } from '../../../../explain/format'
import { ParamField } from '../../../../ui/ParamField'
import { ProvenanceBadge } from '../../../../ui/ProvenanceBadge'
import { saveFinParams, usePassport } from '../../../passport/passportStore'
import { Chip } from '../../../../ui/kit'
import { effectiveFields, isChanged, useWizard, wizardActions } from '../wizardStore'

type Draft = Partial<Pick<FinParams, 'c0' | 'credit_limit' | 'spread' | 'dpo_weeks' | 'pd' | 'repair_budget_weekly' | 'tau_v' | 'tau_p' | 'dscr_covenant'>>

const FIELDS: ReadonlyArray<{ key: keyof Draft; label: string; code: string; unit?: string; scale?: number; step?: number; range?: [number, number]; note?: string }> = [
  { key: 'c0', label: 'Касса на старте C₀', code: 'fin.c0', unit: '₽', step: 100000, note: 'Единица денег = единица цен НСИ (в демо — ₽).' },
  { key: 'credit_limit', label: 'Лимит кредитной линии', code: 'fin.credit_limit', unit: '₽', step: 1000000, note: 'Масштаб демо-инстанса; данных банка нет [К].' },
  { key: 'spread', label: 'Спред линии над ключевой', code: 'fin.spread', unit: '%/год', scale: 100, step: 0.25, range: [0, 15] },
  { key: 'dpo_weeks', label: 'Отсрочка поставщикам DPO', code: 'fin.dpo_weeks', unit: 'нед', step: 1, range: [0, 12] },
  { key: 'pd', label: 'Вероятность дефолта покупателя', code: 'fin.pd', unit: '%', scale: 100, step: 0.5, range: [0, 30] },
  { key: 'repair_budget_weekly', label: 'Бюджет ремонтов в неделю', code: 'fin.repair_budget_weekly', unit: '₽', step: 10000 },
  { key: 'tau_v', label: 'НДС', code: 'fin.tau_v', unit: '%', scale: 100, step: 1, range: [0, 30] },
  { key: 'tau_p', label: 'Налог на прибыль', code: 'fin.tau_p', unit: '%', scale: 100, step: 1, range: [0, 40] },
  { key: 'dscr_covenant', label: 'Ковенант DSCR', code: 'fin.dscr_covenant', step: 0.1, range: [1, 2] },
]

export function FinancialCard({ open }: { open: boolean }) {
  const w = useWizard()
  const passport = usePassport()
  const fin = passport.fin
  const f = effectiveFields(w)
  const [draft, setDraft] = useState<Draft>({})
  const [saving, setSaving] = useState<'idle' | 'busy' | 'saved' | 'error'>('idle')
  const [expanded, setExpanded] = useState(open)
  useEffect(() => { setExpanded(open) }, [open])
  const dirty = Object.keys(draft).length > 0
  const valueOf = (k: keyof Draft): number | null => (draft[k] ?? fin?.[k] ?? null)

  const save = async () => {
    if (!dirty) return
    setSaving('busy')
    try { await saveFinParams(draft); setDraft({}); setSaving('saved') } catch { setSaving('error') }
  }
  const dso = fin ? fin.dso_kernel.reduce((a, wk, i) => a + wk * i, 0) : null

  return (
    <section className={`wz-card wz-fin${expanded ? ' is-open' : ''}`} aria-label="Финансовые ограничения">
      <div className="wz-card__head">
        <p className="wz-card__t">
          Финансовые ограничения · слой F
          <span className="wz-badges" style={{ marginLeft: 8 }}>
            {passport.finStatus === 'ready' ? <Chip tone="good">fin_params загружены</Chip> : passport.finStatus === 'error' ? <Chip tone="bad">fin_params недоступны</Chip> : <Chip>загрузка…</Chip>}
            <ProvenanceBadge status="К" long title="Данных предприятия нет (Р8): все внутренние параметры денег — калибровка или норматив" />
          </span>
        </p>
        <button type="button" className="btn btn--sm" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>{expanded ? 'Свернуть' : 'Раскрыть'}</button>
      </div>
      {fin && !expanded && (
        <p className="pl-note">
          C₀ <b className="num">{money(fin.c0)}</b> · лимит <b className="num">{money(fin.credit_limit)}</b> · ставка линии <b className="num">{num((fin.key_rate + fin.spread) * 100, 1)} %</b> ·
          DSO ≈ <b className="num">{dso !== null ? num(dso, 1) : '—'} нед</b> · DPO <b className="num">{fin.dpo_weeks} нед</b> · L_min <b className="num">{money(f.lMin)}</b> · β <b className="num">{pct(f.beta, 0)}</b>
        </p>
      )}
      {expanded && (
        <>
          <p className="wz-sub text-caps">Параметры прогона (не пишутся в проект)</p>
          <div className="wz-fields">
            <ParamField label="Порог ликвидности L_min" value={f.lMin} unit="₽" status={passport.byCode['fin.l_min']?.status ?? 'К'} provenance={isChanged(w, 'lMin') ? 'manual' : 'calibrated'}
              owner={isChanged(w, 'lMin') ? 'этот прогон' : w.owners.lMin ?? 'умолчание'} changed={isChanged(w, 'lMin')} onRevert={() => wizardActions.revert('lMin')}
              step={100000} onChange={(v) => wizardActions.setOverride('lMin', v)} info="cash.pol"
              note="«Касса ≥ L_min в каждую неделю худших β сценариев» — ограничение CVaR-LP; цена — PoL на шаге «Результат»." />
            <ParamField label="β хвоста кассы (CFaR)" value={f.beta * 100} unit="%" status={passport.byCode['fin.beta']?.status ?? 'К'} provenance={isChanged(w, 'beta') ? 'manual' : 'calibrated'}
              owner={isChanged(w, 'beta') ? 'этот прогон' : w.owners.beta ?? 'умолчание'} changed={isChanged(w, 'beta')} onRevert={() => wizardActions.revert('beta')}
              range={[1, 25]} step={1} onChange={(v) => wizardActions.setOverride('beta', v / 100)} info="cash.cfar" />
          </div>
          <p className="wz-sub text-caps">Параметры проекта (fin_params · паспорт)</p>
          <div className="wz-fields">
            {FIELDS.map((fd) => {
              const sp = passport.byCode[fd.code]
              const raw = valueOf(fd.key)
              const shown = raw === null ? null : raw * (fd.scale ?? 1)
              return (
                <ParamField key={fd.key} label={fd.label} value={shown} unit={fd.unit} status={sp?.status ?? 'К'} owner={sp?.source || 'fin_params'} range={fd.range} step={fd.step}
                  changed={draft[fd.key] !== undefined} onRevert={() => setDraft((d) => { const { [fd.key]: _x, ...rest } = d; return rest })}
                  onChange={fin ? (v) => setDraft((d) => ({ ...d, [fd.key]: v / (fd.scale ?? 1) })) : undefined} readOnly={!fin}
                  note={[fd.note, sp?.note].filter(Boolean).join(' ') || undefined} />
              )
            })}
            <ParamField label="Ядро инкассации DSO" value={fin ? fin.dso_kernel.map((x) => String(x).replace('.', ',')).join(' / ') : null} status={passport.byCode['fin.dso_kernel']?.status ?? 'К'}
              owner={passport.byCode['fin.dso_kernel']?.source || 'fin_params'} readOnly effect={dso !== null ? <>DSO ≈ <b className="num">{num(dso, 1)} нед</b></> : undefined}
              note="Доли выручки по неделям после отгрузки; правится как массив — через паспорт (PUT /api/fin_params), не в мастере." />
          </div>
          <div className="wz-row">
            <button type="button" className="btn btn--primary" onClick={save} disabled={!dirty || saving === 'busy'}>{saving === 'busy' ? 'Сохраняем…' : 'Сохранить в проект'}</button>
            {saving === 'saved' && !dirty && <Chip tone="good">Сохранено ✓</Chip>}
            {saving === 'error' && <Chip tone="bad">не сохранено — бэкенд отверг значения</Chip>}
            <span className="pl-note">Запись в fin_params — явное действие; черновик до сохранения — только здесь.</span>
          </div>
        </>
      )}
    </section>
  )
}
