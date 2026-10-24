/**
 * Полоса методологии (UX-V2 §2.4, X2 «конвейер виден и связан»): 8 ячеек-блоков с состоянием для
 * текущего контекста и родословная результата справа («Базовый · портфель 17:02 · план №28 · 17:38»,
 * каждая часть — ссылка, «▲ устарело», если вход новее результата).
 * Клик по ячейке ведёт на экран-владелец блока (blockHome.ts); блоки текущего экрана — на узел карты.
 * Состояние несёт глиф (✕ ошибка · ▲ устарело · ◌ не задано…), а не цвет текста: вторая строка
 * отклонения — «слово: причина». Ширина — по контейнеру полосы (@container), а не окна: открытый
 * MENTAT не обрезает подписи.
 */
import { Fragment, type CSSProperties } from 'react'
import { BLOCKS } from '../features/method-map/blocks'
import { liveOf } from '../features/method-map/deriveState'
import { StateGlyph } from '../features/method-map/StateGlyph'
import type { BlockId, MethodMapState, NodeLive } from '../features/method-map/types'
import { useMethodMapState } from '../features/method-map/useMethodMapState'
import { useOptStore } from '../features/optimization/optStore'
import { usePlanStore } from '../features/plan/planStore'
import { time } from '../explain/format'
import { BLOCK_HOME, blockHref } from '../shell/blockHome'
import { isStale, useInputsChanged } from '../shell/context'
import { Icon } from '../shell/icons'
import { vocabForState } from './stateVocabulary'
import './pipeline.css'

interface PipelineStripProps {
  /** Блоки, которые реализует текущий экран (подсвечиваются, ведут на карту). */
  activeBlocks?: readonly BlockId[]
}

const ABNORMAL = new Set(['error', 'stale', 'unconfigured'])

/** Вторая строка ячейки: у отклонений — «слово: причина», у текущих блоков — бейдж. */
function secondLine(l: NodeLive, current: boolean): string | null {
  const word = vocabForState(l.state).word
  if (ABNORMAL.has(l.state)) return `${word}: ${l.detail ?? l.reason ?? l.badge ?? 'см. карту'}`
  return current ? l.badge ?? word : null
}

export function PipelineStrip({ activeBlocks = [] }: PipelineStripProps) {
  const { state, scenario } = useMethodMapState()
  return (
    <div className="pstrip-wrap">
      <nav className="pstrip" aria-label="Полоса методологии: состояние восьми блоков и родословная результата">
        <ol className="pstrip__cells">
          {BLOCKS.map((b) => {
            const l = liveOf(state, b.id)
            const current = activeBlocks.includes(b.id)
            const v = vocabForState(l.state)
            const line = secondLine(l, current)
            const home = BLOCK_HOME[b.id]
            const href = blockHref(b.id, current)
            const where = current ? 'на карте ↗' : home.kind === 'action' ? `открыть ${home.label} ↗` : `${home.label} ↗`
            const title = `[${b.n}] ${b.title} — ${v.word}${l.badge ? `: ${l.badge}` : ''}${l.reason ? ` · ${l.reason}` : ''} · ${where}`
            const body = (
              <>
                <span className="pstrip__n mono">{b.n}</span>
                <span className="pstrip__text">
                  <span className="pstrip__name">{b.short}</span>
                  {line && <span className="pstrip__badge">{line}</span>}
                </span>
                <StateGlyph state={l.state} />
              </>
            )
            return (
              <li key={b.id} className={`pstrip__cell is-${l.state}${current ? ' is-current' : ''}`} style={{ '--block': b.colorVar } as CSSProperties}>
                {href !== null ? (
                  <a href={href} className="pstrip__link" aria-current={current ? 'location' : undefined} title={title}>{body}</a>
                ) : (
                  <button type="button" className="pstrip__link pstrip__link--btn" title={title}
                    onClick={() => { if (home.kind === 'action') home.run() }}>{body}</button>
                )}
              </li>
            )
          })}
        </ol>
        <Lineage state={state} scenarioName={scenario ? scenario.name || 'Сценарий' : null} />
        <a className="btn btn--ghost btn--icon pstrip__map" href="#/map" title="Карта методологии" aria-label="Карта методологии">
          <Icon name="graph" size={16} />
        </a>
      </nav>
    </div>
  )
}

interface LineagePart { key: string; text: string; href: string; stale?: string }

/** Родословная: сценарий → портфель → план; «▲ устарело», если вход изменился после расчёта. */
function Lineage({ state, scenarioName }: { state: MethodMapState; scenarioName: string | null }) {
  const opt = useOptStore()
  const plan = usePlanStore()
  const changed = useInputsChanged()
  const parts: LineagePart[] = []
  if (scenarioName) parts.push({ key: 'sc', text: scenarioName, href: '#/scenarios' })
  if (opt.ranAt) {
    const stale = liveOf(state, 'dec.portfolio').state === 'stale' || isStale(opt.ranAt, changed.scenario)
    parts.push({ key: 'pf', text: `портфель ${time(opt.ranAt)}`, href: '#/optimization', stale: stale ? 'вход изменился после расчёта портфеля' : undefined })
  }
  if (plan.builtAt) {
    const id = plan.result?.plan_id
    const no = id && /^\d+$/.test(id) ? `план №${id}` : 'план'
    const stale = liveOf(state, 'dec.schedule').state === 'stale' || isStale(plan.builtAt, changed.nsi)
    parts.push({ key: 'pl', text: `${no} · ${time(plan.builtAt)}`, href: id ? `#/plan/run/${encodeURIComponent(id)}` : '#/plan', stale: stale ? 'портфель или справочники изменились после построения плана' : undefined })
  }
  if (parts.length === 0) return null
  return (
    <p className="pstrip__lineage" aria-label="Родословная результата">
      {parts.map((p, i) => (
        <Fragment key={p.key}>
          {i > 0 && <span className="pstrip__dot" aria-hidden="true">·</span>}
          <a className="pstrip__lin" href={p.href} title={p.stale ? `${p.text} — устарело: ${p.stale}` : p.text}>
            {p.text}
            {p.stale && <span className="pstrip__stale"><span className="mm-glyph mm-glyph--stale" aria-hidden="true" /> устарело</span>}
          </a>
        </Fragment>
      ))}
    </p>
  )
}
