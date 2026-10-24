/**
 * Шапка сценария (X2 «ответ сначала», «один главный шаг»): крошки «Сценарии › Базовый › Условия»;
 * строка заголовка — имя (ввод), тип режима нейтральным чипом «● прогноз / ◆ стресс», «Сохранено»
 * и действия: главное — следующий шаг конвейера «Найти робастный портфель →», тихое «Построить
 * план →», «Сделать рабочим» (просмотр рабочий не меняет), редкое — в «⋯» (копия, удаление).
 * Строка меты: горизонт (дата начала · месяцы → конец выводится), сводка критерия-чип
 * «CVaR · α 10 % · ≤ 60 % ✎» (раскрывает три поля), «изменено N полей · вернуть все», описание.
 */
import { useState } from 'react'
import type { MacroRegimes, PriceScenario } from '../../lib/api'
import { countText, dateTime, pct } from '../../explain/format'
import { objectiveLabel } from '../../explain/labels'
import { InfoTip } from '../../ui/InfoTip'
import { ParamField } from '../../ui/ParamField'
import { Breadcrumbs, Chip, Menu, ScreenHeader, Segmented, showUndo } from '../../ui/kit'
import { OBJECTIVES } from '../optimization/optTypes'
import { usePassport } from '../passport/passportStore'
import { fromMacroMode, regimeChip, regimeLabel } from './regimeMenu'
import {
  CONDITION_KEYS, CRITERION_KEYS, SCENARIO_DEFAULTS, changedKeys, effectiveScenario, endDateOf, fieldBadge, resetPatch,
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
const TAB_TITLE: Record<ScenarioTab, string> = { conditions: 'Условия', distributions: 'Распределения', forecast: 'Прогноз и проверка' }
const MONTHS_MIN = 1
const FIELD_FORMS = ['поле', 'поля', 'полей'] as const
const MONTHS_MAX = 36

interface Props {
  sc: PriceScenario
  tab: ScenarioTab
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

export function ScenarioHeader({ sc, tab, saveStatus, regimes, isWorking, onPatch, onMakeWorking, onFindPortfolio, onBuildPlan, onClone, onRemove }: Props) {
  const [critOpen, setCritOpen] = useState(false)
  const state = fromMacroMode(sc.macro_mode)
  const chip = regimeChip(state)
  const regime = regimeLabel(state, regimes?.regimes.map((r) => r.label))
  return (
    <>
      <Breadcrumbs className="sc2-crumbs" items={[
        { label: 'Сценарии', href: '#/scenarios' },
        { label: sc.name || 'Без названия', href: `#/scenarios/${encodeURIComponent(sc.id)}` },
        { label: TAB_TITLE[tab] },
      ]} />
      <ScreenHeader
        className="sc2-head"
        title={<input className="sc2-head__name" value={sc.name} aria-label="Название сценария" onChange={(e) => onPatch(sc, { name: e.target.value })} />}
        provenance={<Chip size="sm" title={regime.text}><span aria-hidden="true">{chip.glyph}</span> {chip.word}</Chip>}
        subtitle={<MetaLine sc={sc} critOpen={critOpen} onToggleCrit={() => setCritOpen((v) => !v)} onPatch={onPatch} />}
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
function MetaLine({ sc, critOpen, onToggleCrit, onPatch }: { sc: PriceScenario; critOpen: boolean; onToggleCrit: () => void; onPatch: Props['onPatch'] }) {
  const eff = effectiveScenario(sc)
  const end = endDateOf(sc.start_date, eff.months)
  const changed = changedKeys(sc, [...CONDITION_KEYS, ...CRITERION_KEYS])
  const objChanged = !eff.isDefault.objective
  const nChanged = changed.length + (objChanged ? 1 : 0)
  const setStart = (start: string) => onPatch(sc, { start_date: start, end_date: endDateOf(start, eff.months) })
  const setMonths = (v: number) => {
    const months = Math.min(MONTHS_MAX, Math.max(MONTHS_MIN, Math.round(v)))
    onPatch(sc, { months: String(months), end_date: endDateOf(sc.start_date, months) })
  }
  const revertAll = () => {
    const prev: Partial<PriceScenario> = Object.fromEntries([...changed.map((k: NumericKey) => [k, sc[k] ?? '']), ...(objChanged ? [['objective', sc.objective ?? '']] : [])])
    onPatch(sc, { ...resetPatch(changed), ...(objChanged ? { objective: SCENARIO_DEFAULTS.objective } : {}) })
    showUndo({ message: `Возвращено к умолчанию: ${countText(nChanged, FIELD_FORMS)}`, onUndo: () => onPatch(sc, prev) })
  }
  return (
    <span className="sc2-meta">
      <span className="sc2-meta__item">
        <label className="sc2-inline">Горизонт
          <input className="sc2-date" type="date" value={sc.start_date || ''} aria-label="Дата начала горизонта" onChange={(e) => setStart(e.target.value)} />
        </label>
        <span aria-hidden="true">·</span>
        <input className="sc2-months num" type="number" min={MONTHS_MIN} max={MONTHS_MAX} step={1} value={eff.months} aria-label="Горизонт, месяцев"
          onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && e.target.value !== '') setMonths(v) }} />
        <span>мес{end ? <> → до {dateTime(end, { time: false })}</> : null}</span>
        {!sc.start_date && <span className="sc2-hint">▲ без даты — сроки от сегодня</span>}
      </span>
      <button type="button" className="sc2-critchip" aria-expanded={critOpen} onClick={onToggleCrit} title="Критерий портфеля и плана — изменить">
        <span>{objectiveLabel(eff.objective)}</span> · <span className="pf-nocaps">α</span> <span className="num">{pct(eff.alpha, 0)}</span> · ≤ <span className="num">{pct(eff.max_share, 0)}</span> <span aria-hidden="true">✎</span>
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
