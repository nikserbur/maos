/**
 * Чипы и «основа расчёта» главной карточки «Мониторинга» (владелец: «цены сбыта +20 % — откуда?»,
 * «длинное служебное имя три раза»): условия называются одним коротким именем пресета («Как 2022»),
 * «◆ что если» — один чип; ручные правки сценария — чипом «■ N параметров вручную» (ведёт на «Условия»)
 * и строкой «Изменено вручную: …» в тех же единицах, что карточки «Сценариев»; основа — генератор,
 * период обучения, прогоны, время, последние данные ЦБ и куда идти менять.
 */
import type { ReactNode } from 'react'
import { countText, dateTimeShort, num } from '../../explain/format'
import { Chip } from '../../ui/kit'
import { monthShort } from '../scenarios/monthText'
import { presetPeriod, type ScenarioPreset } from '../scenarios/scenarioPresets'
import { FORECAST_RUNS } from './forecastModel'
import { monthName } from './monitorModel'
import { changesText, type ManualChange } from './monitorSource'

const PARAMS = ['параметр', 'параметра', 'параметров'] as const

interface ChipsProps {
  /** Имя условий «что если» («Как 2022», «Что если»); прогноз — null. */
  whatIf: string | null
  changes: readonly ManualChange[]
  conditionsHref: string | null
  demo: boolean
  synthetic: boolean
}

export function HeadlineChips({ whatIf, changes, conditionsHref, demo, synthetic }: ChipsProps) {
  return (
    <>
      {whatIf
        ? <Chip size="sm" tone="info" title="Что если — так могло бы пойти, а не прогноз">что если «{whatIf}»</Chip>
        : <Chip size="sm" title="Генератор, обученный на истории ЦБ РФ, от сегодняшней точки — прогноз"><span aria-hidden="true">●</span> прогноз · обучено на истории</Chip>}
      {changes.length > 0 && conditionsHref && (
        <a className="mon-status__chiplink" href={conditionsHref} title={`Изменено вручную: ${changesText(changes)} — открыть «Условия» сценария`}>
          <Chip size="sm"><span aria-hidden="true">■</span> {countText(changes.length, PARAMS)} вручную</Chip>
        </a>
      )}
      {demo && (
        <Chip size="sm" title="Веера и сигналы цен ориентировочные — не результат по фактическим ценам">
          <span aria-hidden="true">▲</span> {synthetic ? 'демо-данные: история цен синтетическая' : 'прогноз цен — демонстрационный модуль'}
        </Chip>
      )}
    </>
  )
}

interface BasisProps {
  /** Пресет условий (для «что если» — что он повторяет). */
  preset: ScenarioPreset | null
  whatIf: string | null
  changes: readonly ManualChange[]
  /** Период обучения генератора: первый и последний месяц рядов ЦБ. */
  trained: { first: string; last: string } | null
  at: number | null
  anchor: string | null
  /** Нет сценария с пресетом «Базовый» — считаем пресет с умолчаниями. */
  noBase: boolean
  /** «вернуться к прогнозу» / «изменить в Сценариях →». */
  link: ReactNode
}

export function HeadlineBasis({ preset, whatIf, changes, trained, at, anchor, noBase, link }: BasisProps) {
  const period = trained ? ` ${monthShort(trained.first)} – ${monthShort(trained.last)}` : ''
  // «Не прогноз» уже сказано чипом и мета-строкой «Внешних условий» — здесь только что повторяется.
  const what = whatIf
    ? `${preset && !preset.isForecast ? `условия «${whatIf}» — ${presetPeriod(preset)}${preset.window ? ' от сегодняшних значений' : ''}` : `условия «${whatIf}»`}; генератор обучен на рядах ЦБ${period}`
    : `прогноз генератора, обученного на рядах ЦБ${period}`
  return (
    <>
      <p>
        Основа: {what} · {num(FORECAST_RUNS, 0)} прогонов{at ? ` · рассчитано ${dateTimeShort(at)}` : ''}
        {anchor ? ` · последние данные ЦБ — за ${monthName(anchor)}` : ''} · {link}
      </p>
      {changes.length > 0 && <p className="mon-status__changes">Изменено вручную: {changesText(changes)}.</p>}
      {noBase && <p>Сценария с пресетом «Базовый» нет — считаем пресет «Базовый» с умолчаниями · <a className="pf-link" href="#/scenarios">создать в Сценариях →</a></p>}
    </>
  )
}
