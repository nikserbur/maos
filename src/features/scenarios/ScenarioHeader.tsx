/**
 * Шапка сценария (X2 «ответ сначала», «один главный шаг»; путь «Сценарии › Базовый › Условия» — только в
 * крошках верхней панели, без второго ряда крошек на странице): строка заголовка — имя (ввод), пресет
 * нейтральным чипом «● Базовый · прогноз» / «◆ Базовый + 2 правки · что если», «Сохранено» и действия:
 * главное — следующий шаг конвейера «Найти робастный портфель →», тихое «Построить план →», «Сделать
 * рабочим» (просмотр рабочий не меняет), редкое — в «⋯» (копия, удаление).
 * Строка меты: горизонт («Начало: сегодня (окт. 2026) · указать дату» · месяцы → конец), сводка
 * критерия-чип «Критерий CVaR · хвост 10 % · доля изделия до 60 % ▾» (раскрывает три поля), «изменено N
 * полей · вернуть все», описание.
 */
import { useState } from 'react'
import type { MacroRegimes, PriceScenario } from '../../lib/api'
import { countText, dateTime, pct } from '../../explain/format'
import { objectiveLabel } from '../../explain/labels'
import { InfoTip } from '../../ui/InfoTip'
import { ParamField } from '../../ui/ParamField'
import { Chip, Menu, ScreenHeader, Segmented, showUndo } from '../../ui/kit'
import { OBJECTIVES } from '../optimization/optTypes'
import { usePassport } from '../passport/passportStore'
import { monthShort } from './monthText'
import { presetEdits, presetOf, scenarioViewOf, viewTitle, type PresetValueKey } from './scenarioPresets'
import {
  CRITERION_KEYS, SCENARIO_DEFAULTS, changedKeys, effectiveScenario, endDateOf, fieldBadge, resetPatch,
  type NumericKey,
} from './scenarioDefaults'
import type { ScenarioTab } from './scenarioRoute'
import type { SaveStatus } from './useScenarioData'
import './scenarios-v2.css'

const SAVE: Record<SaveStatus, { text: string; tone?: 'bad' }> = {
  pending: { text: 'сохраняем…' },
  saved: { text: 'Сохранено' },
  error: { text: '✕ не сохранено — нет связи', tone: 'bad' },
}
/** Текущий месяц «YYYY-MM» (начало горизонта без даты — сегодня). */
function todayMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** Критерий словами в чипе: формула «E − λ·σ» — только в подсказке. */
const OBJECTIVE_WORDS: Readonly<Record<string, string>> = { meanvariance: 'прибыль минус риск' }
const objectiveWords = (id: string): string => OBJECTIVE_WORDS[id] ?? objectiveLabel(id)
const MONTHS_MIN = 1
const FIELD_FORMS = ['поле', 'поля', 'полей'] as const
const MONTHS_MAX = 36

interface Props {
  sc: PriceScenario
  /** Открытая вкладка (путь показывают крошки верхней панели). */
  tab?: ScenarioTab
  saveStatus?: SaveStatus
  regimes: MacroRegimes | null
  isWorking: boolean
  onPatch: (sc: PriceScenario, p: Partial<PriceScenario>) => void
  onMakeWorking: () => void
  onFindPortfolio: () => void
  onBuildPlan: () => void
  onClone: () => void
  onRemove: () => void
}

export function ScenarioHeader({ sc, saveStatus, regimes, isWorking, onPatch, onMakeWorking, onFindPortfolio, onBuildPlan, onClone, onRemove }: Props) {
  const [critOpen, setCritOpen] = useState(false)
  const view = scenarioViewOf(sc, regimes?.regimes.map((r) => r.label), { lastObs: regimes?.last_obs })
  return (
    <>
      <ScreenHeader
        className="sc2-head"
        title={<input className="sc2-head__name" value={sc.name} aria-label="Название сценария" onChange={(e) => onPatch(sc, { name: e.target.value })} />}
        provenance={<Chip size="sm" title={`${view.name}: ${view.mode}`}><span aria-hidden="true">{view.glyph}</span> {viewTitle(view)} · {view.kind}</Chip>}
        subtitle={<MetaLine sc={sc} regimes={regimes} critOpen={critOpen} onToggleCrit={() => setCritOpen((v) => !v)} onPatch={onPatch} />}
        actions={
          <>
            {saveStatus && <Chip tone={SAVE[saveStatus].tone} size="sm" title="Поля сохраняются через 400 мс после правки">{SAVE[saveStatus].text}</Chip>}
            {isWorking
              ? <span className="sc2-working" title="С этим сценарием считают Портфель и План">● рабочий</span>
              : <button type="button" className="btn btn--ghost" onClick={onMakeWorking} title="Портфель и План будут считать с этим сценарием">Сделать рабочим</button>}
            <button type="button" className="btn btn--ghost" onClick={onBuildPlan}>Построить план →</button>
            <button type="button" className="btn btn--primary" onClick={onFindPortfolio}>Найти робастный портфель →</button>
            <Menu label="Ещё действия" items={[
              { id: 'clone', label: 'Клонировать', icon: 'layers', onSelect: onClone, hint: 'Копия со всеми условиями и распределениями' },
              { id: 'remove', label: 'Удалить сценарий…', icon: 'close', danger: true, onSelect: onRemove, hint: 'С подтверждением; портфели в истории останутся' },
            ]} />
          </>
        }
      />
      {critOpen && <CriterionRow sc={sc} onPatch={onPatch} />}
    </>
  )
}

/** Строка меты: горизонт · сводка критерия · «изменено N полей · вернуть все» · описание. */
function MetaLine({ sc, regimes, critOpen, onToggleCrit, onPatch }: { sc: PriceScenario; regimes: MacroRegimes | null; critOpen: boolean; onToggleCrit: () => void; onPatch: Props['onPatch'] }) {
  const ctx = { lastObs: regimes?.last_obs }
  const eff = effectiveScenario(sc, ctx)
  const end = endDateOf(sc.start_date, eff.months)
  // Правки — поверх пресета (его значения правками не считаются) + критерий.
  const preset = presetOf(sc.macro_mode)
  const changed: NumericKey[] = [...presetEdits(sc, ctx), ...changedKeys(sc, CRITERION_KEYS, ctx)]
  const objChanged = !eff.isDefault.objective
  const nChanged = changed.length + (objChanged ? 1 : 0)
  const [dateOpen, setDateOpen] = useState(false)
  const setStart = (start: string) => onPatch(sc, { start_date: start, end_date: endDateOf(start, eff.months) })
  const setMonths = (v: number) => {
    const months = Math.min(MONTHS_MAX, Math.max(MONTHS_MIN, Math.round(v)))
    onPatch(sc, { months: String(months), end_date: endDateOf(sc.start_date, months) })
  }
  const revertAll = () => {
    const prev: Partial<PriceScenario> = Object.fromEntries([...changed.map((k: NumericKey) => [k, sc[k] ?? '']), ...(objChanged ? [['objective', sc.objective ?? '']] : [])])
    const back = Object.fromEntries(changed.map((k) => {
      const pv = preset?.values[k as PresetValueKey]
      return [k, pv !== undefined ? String(pv) : resetPatch([k], ctx)[k] ?? '']
    }))
    onPatch(sc, { ...back, ...(objChanged ? { objective: SCENARIO_DEFAULTS.objective } : {}) })
    showUndo({ message: `Возвращено к умолчанию: ${countText(nChanged, FIELD_FORMS)}`, onUndo: () => onPatch(sc, prev) })
  }
  return (
    <span className="sc2-meta">
      <span className="sc2-meta__item">
        <span>Горизонт</span>
        <input className="sc2-months num" type="number" min={MONTHS_MIN} max={MONTHS_MAX} step={1} value={eff.months} aria-label="Горизонт, месяцев"
          onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && e.target.value !== '') setMonths(v) }} />
        <span>мес{end ? <> → до {dateTime(end, { time: false })}</> : null}</span>
        <span aria-hidden="true">·</span>
        {sc.start_date || dateOpen ? (
          <label className="sc2-inline">Начало
            <input className="sc2-date" type="date" value={sc.start_date || ''} aria-label="Дата начала горизонта" autoFocus={dateOpen && !sc.start_date}
              onChange={(e) => setStart(e.target.value)} />
          </label>
        ) : (
          <span className="sc2-start">
            Начало: сегодня ({monthShort(todayMonth())})
            <button type="button" className="pf-link" onClick={() => setDateOpen(true)}>указать дату</button>
          </span>
        )}
      </span>
      <button type="button" className="sc2-critchip" aria-expanded={critOpen} onClick={onToggleCrit} title={`Критерий портфеля и плана — ${objectiveLabel(eff.objective, 'long')}; нажмите, чтобы изменить`}>
        <span>Критерий: {objectiveWords(eff.objective)}</span> · хвост <span className="num">{pct(eff.alpha, 0)}</span> · доля изделия до <span className="num">{pct(eff.max_share, 0)}</span>
        <svg className="sc2-critchip__chev" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {nChanged > 0 && (
        <span className="sc2-meta__item sc2-changed">
          изменено {countText(nChanged, FIELD_FORMS)}
          <button type="button" className="pf-link" onClick={revertAll}>· вернуть все</button>
        </span>
      )}
      <input className="sc2-head__desc" placeholder="Описание — чем этот сценарий отличается" value={sc.description || ''} aria-label="Описание сценария"
        onChange={(e) => onPatch(sc, { description: e.target.value })} />
    </span>
  )
}

/** Критерий: три поля; «Портфель» и «План» наследуют его (ссылки — в «i»). */
function CriterionRow({ sc, onPatch }: { sc: PriceScenario; onPatch: Props['onPatch'] }) {
  const passport = usePassport()
  const eff = effectiveScenario(sc)
  const objective = eff.objective
  const objLabel = objectiveLabel(objective)
  return (
    <section className="sc2-crit" aria-label="Критерий портфеля и плана">
      <ParamField label="Критерий робастности" value={objLabel} provenance={eff.isDefault.objective ? 'default' : 'manual'}
        changed={!eff.isDefault.objective} onRevert={() => onPatch(sc, { objective: SCENARIO_DEFAULTS.objective })}>
        <Segmented label="Критерий робастности" value={objective as (typeof OBJECTIVES)[number]['id']} onChange={(id) => onPatch(sc, { objective: id })}
          options={OBJECTIVES.map((o) => ({ id: o.id, label: objectiveLabel(o.id), title: o.hint }))} />
      </ParamField>
      <ParamField label="α хвоста" value={eff.alpha * 100} unit="%" {...fieldBadge('alpha', eff.alpha, passport.byCode['r1.19']?.status ?? 'К')}
        changed={!eff.isDefault.alpha} onRevert={() => onPatch(sc, { alpha: String(SCENARIO_DEFAULTS.alpha) })}
        range={[1, 50]} step={1} min={1} max={50} onChange={(v) => onPatch(sc, { alpha: String(v / 100) })} info="opt.cvar" infoValues={{ alpha: eff.alpha }}
        hint="Один α на портфель, план, кассу и агента: «худшие α·100 % сценариев»." />
      <ParamField label="Макс. доля изделия" value={eff.max_share * 100} unit="%" {...fieldBadge('max_share', eff.max_share, passport.byCode['r1.40']?.status ?? 'НОРМ')}
        changed={!eff.isDefault.max_share} onRevert={() => onPatch(sc, { max_share: String(SCENARIO_DEFAULTS.max_share) })}
        range={[10, 100]} step={5} min={10} max={100} onChange={(v) => onPatch(sc, { max_share: String(v / 100) })} info="opt.max_share"
        effect={<>не более <b className="num">{pct(eff.max_share, 0)}</b> выручки на одно изделие</>} />
      <p className="sc2-crit__note">
        Критерий задаётся только здесь
        <InfoTip id="opt.cvar" values={{ alpha: eff.alpha }} label="Где действует критерий"
          note={<><a className="pf-link" href="#/optimization">«Портфель»</a> и <a className="pf-link" href="#/plan">«План»</a> наследуют критерий сценария; переопределить его можно только на один прогон — с пометкой.</>} />
      </p>
    </section>
  )
}
