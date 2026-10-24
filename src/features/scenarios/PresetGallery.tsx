/**
 * Галерея пресетов (владелец: «дружелюбнее; базовый — обучено на истории; больше пресетов из истории»):
 * три группы — «Прогноз» (Базовый — широкая карточка во всю строку) · «Как в истории» · «Стресс-тесты».
 * Карточка: имя; одна фраза; чип периода («повторяет март–сент. 2020») с мини-графиками ставки и доллара
 * того окна; таблица «тогда → сейчас так» (история ЦБ РФ и типичный исход генератора от сегодняшних
 * значений через N мес); у стресса без изменения ставки и курса — что он меняет в рынке изделий.
 * Ниже — «Что меняет пресет относительно Базового»: только отличающиеся строки с происхождением словами.
 * Один компонент для создания сценария, «Сменить пресет» и пустого экрана.
 */
import { useEffect, useId, useState } from 'react'
import type { MacroRegimes } from '../../lib/api'
import { NBSP, num } from '../../explain/format'
import { Sparkline } from '../../ui/charts'
import { ChoiceCards } from '../../ui/kit'
import { conditionSpec } from './conditionFields'
import { monthShort, windowLabel } from './monthText'
import { historyThenParts, historyWindow, sampleStats, statCells, type SampleStats } from './presetStats'
import {
  PRESETS, PRESET_GROUPS, PRESET_MONTHS, presetMacroMode, presetPeriod, presetValuesText, type PresetValueKey, type ScenarioPreset,
} from './scenarioPresets'
import { fetchMacroSample } from './useMacroSample'
import './scenario-presets.css'

/** Пресет меняет ставку, курс или инфляцию (иначе исход генератора — как у Базового, его не повторяем). */
const movesMacro = (p: ScenarioPreset): boolean => Boolean(p.window || p.keyRef !== undefined || p.fxRef !== undefined || p.id === 'base')

/** Исход генератора по каждому пресету; пока считается — нет ключа, ошибка — null. */
function usePresetStats(months: number, enabled: boolean): Readonly<Record<string, SampleStats | null>> {
  const [stats, setStats] = useState<Record<string, SampleStats | null>>({})
  useEffect(() => {
    if (!enabled) return undefined
    let alive = true
    for (const p of PRESETS.filter(movesMacro)) {
      fetchMacroSample(presetMacroMode(p, months), months)
        .then((r) => { if (alive) setStats((e) => ({ ...e, [p.id]: sampleStats(r) })) })
        .catch(() => { if (alive) setStats((e) => ({ ...e, [p.id]: null })) })
    }
    return () => { alive = false }
  }, [months, enabled])
  return stats
}

/** «157 мес: сент. 2013 – сент. 2026» — длина и границы истории генератора; без истории — ''. */
export function historySpan(regimes: MacroRegimes | null): string {
  const m = regimes?.history?.month
  if (!m || m.length < 2) return ''
  return `${num(m.length, 0)}${NBSP}мес: ${monthShort(m[0])} – ${monthShort(m[m.length - 1])}`
}

/** «обучено на истории ЦБ РФ (157 мес: сент. 2013 – сент. 2026)». */
export function trainedOn(regimes: MacroRegimes | null): string {
  const span = historySpan(regimes)
  return span ? `обучено на истории ЦБ РФ (${span})` : 'обучено на истории ЦБ РФ'
}

interface GalleryProps {
  value: string | null
  onChange: (id: string) => void
  regimes: MacroRegimes | null
  months?: number
  /** Считать исход каждого пресета генератором (галерея в диалоге). */
  withEffects?: boolean
}

export function PresetGallery({ value, onChange, regimes, months = PRESET_MONTHS, withEffects = true }: GalleryProps) {
  const uid = useId()
  const stats = usePresetStats(months, withEffects)
  return (
    <div className="scp-gallery">
      {PRESET_GROUPS.map((g) => {
        const capId = `${uid}-${g.id}`
        const items = PRESETS.filter((p) => p.group === g.id)
        return (
          <section key={g.id} className="scp-group" aria-labelledby={capId}>
            <h3 className="scp-group__title" id={capId}>{g.title} <span className="scp-group__sub">{g.subtitle}</span></h3>
            <ChoiceCards labelledBy={capId} label={g.title} value={value} onChange={onChange} size={g.id === 'forecast' ? 'lg' : 'md'}
              className={`scp-cards scp-cards--${g.id}`}
              options={items.map((p) => ({
                id: p.id,
                title: <>{p.name}{p.isForecast && <span className="scp-tag"><span aria-hidden="true">●</span> прогноз</span>}</>,
                description: p.oneLine,
                meta: <PresetMeta p={p} regimes={regimes} months={months} stats={withEffects ? stats[p.id] : undefined} withEffects={withEffects} />,
              }))} />
          </section>
        )
      })}
    </div>
  )
}

interface MetaProps { p: ScenarioPreset; regimes: MacroRegimes | null; months: number; stats: SampleStats | null | undefined; withEffects: boolean }

/** Низ карточки: период с мини-графиками окна и таблица «тогда → сейчас так» (или что меняет стресс). */
function PresetMeta({ p, regimes, months, stats, withEffects }: MetaProps) {
  const keyLine = historyWindow(regimes?.history, p.window, 'key_pp')
  const fxLine = historyWindow(regimes?.history, p.window, 'usd_rub')
  return (
    <>
      <span className="scp-meta__period">
        <span className="scp-chip">{p.id === 'base' ? trainedOn(regimes) : presetPeriod(p)}</span>
        {keyLine.length > 2 && (
          <span className="scp-spark" aria-hidden="true">
            <span className="scp-spark__k">ставка</span><Sparkline points={keyLine} width={56} height={18} bare />
            <span className="scp-spark__k">доллар</span><Sparkline points={fxLine} width={56} height={18} bare color="var(--chart-2)" />
          </span>
        )}
      </span>
      {!movesMacro(p) ? <span className="scp-meta__values">{presetValuesText(p)}</span>
        : withEffects ? <ThenNow p={p} regimes={regimes} months={months} stats={stats} /> : null}
    </>
  )
}

/** Таблица «тогда (история) → сейчас так (генератор через N мес)» по ставке, доллару и инфляции. */
function ThenNow({ p, regimes, months, stats }: { p: ScenarioPreset; regimes: MacroRegimes | null; months: number; stats: SampleStats | null | undefined }) {
  if (stats === null) return <span className="scp-meta__values">пути генератора не посчитаны — откройте позже</span>
  if (stats === undefined) return <span className="scp-meta__values">считаем пути генератора…</span>
  const then = historyThenParts(regimes?.history, p.window)
  const now = statCells(stats)
  const thenOf = (title: string) => then.find((t) => title.toLowerCase().startsWith(t.title))
  return (
    <span className={`scp-then${then.length > 0 ? '' : ' scp-then--now'}`}>
      <span className="scp-then__row scp-then__head">
        <span />
        {then.length > 0 && <span>тогда</span>}
        <span>{p.isForecast ? `через ${num(months, 0)}${NBSP}мес` : `сейчас так, ${num(months, 0)}${NBSP}мес`}</span>
      </span>
      {now.map((c) => {
        const t = thenOf(c.title)
        return (
          <span key={c.k} className="scp-then__row">
            <span className="scp-then__k">{c.title}</span>
            {then.length > 0 && <span className="num scp-then__v">{t ? `${num(t.from, t.digits)} → ${num(t.to, t.digits)}${NBSP}${t.unit}` : '—'}</span>}
            <span className="num"><span className="scp-then__v">{c.text}</span>{c.note && <span className="scp-then__note">{c.note}</span>}</span>
          </span>
        )
      })}
    </span>
  )
}

interface DiffRow { what: string; value: string; origin: string }

/** Строки «что меняет пресет относительно Базового». */
export function presetDiffRows(p: ScenarioPreset): DiffRow[] {
  const rows: DiffRow[] = []
  if (p.window) {
    const period = windowLabel(p.window.from, p.window.months)
    rows.push({ what: 'Ставка, инфляция и курс', value: `повтор изменений ${period} по порядку, от сегодняшних значений`, origin: `история ЦБ РФ, ${period}` })
  }
  if (p.keyRef !== undefined) rows.push({ what: 'Ключевая ставка', value: `около ${num(p.keyRef, 0)}${NBSP}% весь горизонт`, origin: 'пик ставки ЦБ РФ в 2024–2025' })
  if (p.fxRef !== undefined) rows.push({ what: 'Курс доллара', value: `+${num((p.fxRef - 1) * 100, 0)}${NBSP}% к курсу по прогнозу во всех путях`, origin: 'стресс-тест — можно изменить в поле «Сдвиг курса доллара»' })
  for (const [key, v] of Object.entries(p.values) as Array<[PresetValueKey, number]>) {
    const spec = conditionSpec(key)
    rows.push({ what: spec.label, value: spec.text(v), origin: p.why?.[key] ?? 'экспертная оценка — можно изменить' })
  }
  return rows
}

/** «Что меняет пресет»: только отличия от Базового; у Базового — откуда все значения. */
export function PresetDiff({ preset, regimes }: { preset: ScenarioPreset; regimes: MacroRegimes | null }) {
  const rows = presetDiffRows(preset)
  return (
    <section className="scp-diff" aria-label="Что меняет пресет">
      <h3 className="scp-diff__title">{preset.isForecast ? 'Откуда значения' : `Что меняет «${preset.short}» относительно Базового`}</h3>
      {rows.length === 0 ? (
        <p className="scp-diff__base">
          Ничего не задаётся вручную: ставка, инфляция и курс — пути генератора, {trainedOn(regimes)}; разброс цен — по истории каждого ряда;
          связь цен — норматив; спрос — справочник НСИ.
        </p>
      ) : (
        <table className="dk-table scp-diff__table">
          <thead><tr><th scope="col">Что меняется</th><th scope="col">Значение</th><th scope="col">Откуда</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.what}><th scope="row">{r.what}</th><td>{r.value}</td><td className="scp-diff__origin">{r.origin}</td></tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
