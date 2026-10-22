/**
 * Шапка сценария (X1 §3.1, п. 3) на `ScreenHeader` единого кита: имя — inline-ввод в заголовке,
 * описание и горизонт (даты, месяцы, режим генератора) — подзаголовком; справа «Сохранено»
 * чипом, «Обновить» (только на вкладке прогноза), «Клонировать» тихой кнопкой и меню ⋯,
 * куда убрано «Удалить» — опасное действие не стоит рядом с безопасными.
 * Ниже — критерий одной строкой «Критерий CVaR · α 10 % · доля изделия ≤ 60 % [изменить]»,
 * раскрывающейся в три поля: единственное место, «Портфель» и «План» наследуют его.
 */
import { useState } from 'react'
import type { MacroRegimes, PriceScenario } from '../../lib/api'
import { num, pct } from '../../explain/format'
import { InfoTip } from '../../ui/InfoTip'
import { ParamField } from '../../ui/ParamField'
import { Chip, IconButton, Menu, ScreenHeader, Segmented } from '../../ui/kit'
import { OBJECTIVES } from '../optimization/optTypes'
import { usePassport } from '../passport/passportStore'
import { fromMacroMode, regimeLabel } from './regimeMenu'
import './scenarios-v2.css'

export type SaveStatus = 'pending' | 'saved' | 'error'
const SAVE: Record<SaveStatus, { text: string; tone: 'idle' | 'good' | 'bad' }> = {
  pending: { text: 'сохраняем…', tone: 'idle' },
  saved: { text: 'Сохранено', tone: 'good' },
  error: { text: 'не сохранено — нет связи', tone: 'bad' },
}
const ALPHA_DEFAULT = 0.1
const MAX_SHARE_DEFAULT = 0.35

interface Props {
  sc: PriceScenario
  saveStatus?: SaveStatus
  regimes: MacroRegimes | null
  /** «Обновить» показывается только там, где есть что пересчитать (вкладка прогноза). */
  onRefresh?: () => void
  onPatch: (sc: PriceScenario, p: Partial<PriceScenario>) => void
  onClone: () => void
  onRemove: () => void
}

export function ScenarioHeader({ sc, saveStatus, regimes, onRefresh, onPatch, onClone, onRemove }: Props) {
  const months = Number(sc.months) || 6
  const regime = regimeLabel(fromMacroMode(sc.macro_mode), regimes?.regimes.map((r) => r.label))
  return (
    <>
      <ScreenHeader
        className="sc2-head"
        eyebrow="Сценарий внешних условий"
        title={<input className="sc2-head__name" value={sc.name} aria-label="Название сценария" onChange={(e) => onPatch(sc, { name: e.target.value })} />}
        subtitle={
          <>
            <input className="sc2-head__desc" placeholder="Описание (чем этот сценарий отличается)" value={sc.description || ''} aria-label="Описание сценария"
                   onChange={(e) => onPatch(sc, { description: e.target.value })} />
            <span className="sc2-head__meta">
              <label className="sc2-inline">Горизонт
                <input className="sc2-date" type="date" value={sc.start_date || ''} aria-label="Дата начала горизонта" onChange={(e) => onPatch(sc, { start_date: e.target.value })} />
                →
                <input className="sc2-date" type="date" value={sc.end_date || ''} aria-label="Дата конца горизонта" onChange={(e) => onPatch(sc, { end_date: e.target.value })} />
              </label>
              <span className="num">{num(months, 0)} мес</span>
              <Chip tone={regime.isForecast ? 'good' : 'warn'} size="sm">{regime.text}</Chip>
              {!sc.start_date && <span className="sc2-warn glyph-setup">без даты начала сроки заказов считаются от сегодняшнего дня</span>}
            </span>
          </>
        }
        actions={
          <>
            {saveStatus && <Chip tone={SAVE[saveStatus].tone} title="Поля сохраняются через 400 мс после правки">{SAVE[saveStatus].text}</Chip>}
            {onRefresh && <IconButton icon="play" onClick={onRefresh} title="Пересчитать прогноз">Обновить</IconButton>}
            <button type="button" className="btn btn--ghost" onClick={onClone}>Клонировать</button>
            <Menu label="Ещё действия" items={[
              { id: 'remove', label: 'Удалить сценарий', icon: 'close', danger: true, onSelect: onRemove, hint: 'С подтверждением; портфели в истории останутся' },
            ]} />
          </>
        }
      />
      <CriterionLine sc={sc} onPatch={onPatch} />
    </>
  )
}

/** Критерий по умолчанию: одна строка со сводкой, по «изменить» — три поля. */
function CriterionLine({ sc, onPatch }: { sc: PriceScenario; onPatch: Props['onPatch'] }) {
  const passport = usePassport()
  const [editing, setEditing] = useState(false)
  const objective = (sc.objective || 'cvar') as (typeof OBJECTIVES)[number]['id']
  const objLabel = OBJECTIVES.find((o) => o.id === objective)?.label ?? objective
  const alpha = Number(sc.alpha) || ALPHA_DEFAULT
  const maxShare = Number(sc.max_share) || MAX_SHARE_DEFAULT

  return (
    <section className={`sc2-crit${editing ? ' is-open' : ''}`} aria-label="Критерий по умолчанию">
      <div className="sc2-crit__line">
        <span className="sc2-crit__k text-caps">Критерий</span>
        <span className="sc2-crit__v">
          <b>{objLabel}</b> · <span className="pf-nocaps">α</span> <b className="num">{pct(alpha, 0)}</b> · доля изделия ≤ <b className="num">{pct(maxShare, 0)}</b>
        </span>
        <InfoTip id="opt.cvar" values={{ alpha }} />
        <button type="button" className="pf-link" aria-expanded={editing} onClick={() => setEditing((v) => !v)}>{editing ? 'свернуть' : 'изменить'}</button>
        <span className="sc2-muted sc2-crit__note">единственное место — «Портфель» и «План» наследуют, переопределить можно только на прогон с пометкой</span>
      </div>
      {editing && (
        <div className="sc2-criterion__row">
          <ParamField label="Критерий робастности" value={objLabel} provenance={objective !== 'cvar' ? 'manual' : 'default'} owner="этот сценарий">
            <Segmented label="Критерий робастности" value={objective} onChange={(id) => onPatch(sc, { objective: id })}
              options={OBJECTIVES.map((o) => ({ id: o.id, label: o.label, title: o.hint }))} />
          </ParamField>
          <ParamField label="α хвоста" value={alpha * 100} unit="%" status={passport.byCode['r1.19']?.status ?? 'К'} provenance={alpha !== ALPHA_DEFAULT ? 'manual' : 'calibrated'} owner="этот сценарий"
            range={[1, 50]} step={1} min={1} max={50} onChange={(v) => onPatch(sc, { alpha: String(v / 100) })} info="opt.cvar"
            hint="Один α на портфель, план, кассу и агента: «худшие α·100 % сценариев»." />
          <ParamField label="Макс. доля изделия" value={maxShare * 100} unit="%" status={passport.byCode['r1.40']?.status ?? 'НОРМ'} provenance={maxShare !== MAX_SHARE_DEFAULT ? 'manual' : 'normative'} owner="этот сценарий"
            range={[10, 100]} step={5} min={10} max={100} onChange={(v) => onPatch(sc, { max_share: String(v / 100) })} info="opt.max_share"
            effect={<>не более <b className="num">{pct(maxShare, 0)}</b> выручки на одно изделие</>} />
        </div>
      )}
    </section>
  )
}
