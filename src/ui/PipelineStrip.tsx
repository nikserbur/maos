/**
 * Полоса методологии (UX-V2 §2.4, X2 «конвейер виден и связан»): 8 ячеек-блоков с состоянием для
 * текущего контекста и родословная результата справа (видна только новейшая часть — «план №29 · 20:24 ▲»,
 * вся цепочка «Базовый → портфель 17:36 → план №29 · 20:24» — в выпадающем списке).
 * Клик по ячейке ведёт на экран-владелец блока (blockHome.ts); ячейка блока, чья вкладка открыта на
 * этом же экране («Условия» на «Сценариях»), ведёт на эту вкладку — то же слово, то же место; прочие
 * блоки текущего экрана — на узел карты (карта целиком — иконка справа).
 * Состояние несёт глиф (✕ ошибка · ▲ устарело · ◌ не задано…), а не цвет текста: вторая строка
 * отклонения — «слово: причина». Ячейка шириной по подписи (подпись никогда не наезжает на глиф и на
 * соседа); ширина — по контейнеру полосы (@container): не хватает места — у обычных ячеек остаются
 * номер и глиф (имя — в подсказке и для диктора), у текущей и отклонений — полное имя.
 */
import type { CSSProperties } from 'react'
import { BLOCKS } from '../features/method-map/blocks'
import { liveOf } from '../features/method-map/deriveState'
import { StateGlyph } from '../features/method-map/StateGlyph'
import type { BlockId, MethodMapState, NodeLive } from '../features/method-map/types'
import { useMethodMapState } from '../features/method-map/useMethodMapState'
import { useOptStore } from '../features/optimization/optStore'
import { usePlanStore } from '../features/plan/planStore'
import { parseScenarioAnchor } from '../features/scenarios/scenarioRoute'
import { time } from '../explain/format'
import { BLOCK_HOME, blockHref } from '../shell/blockHome'
import { isStale, useInputsChanged } from '../shell/context'
import { Icon } from '../shell/icons'
import { buildHash, joinAnchor, useHashRoute } from '../shell/router'
import { Menu, type MenuItem } from './kit/Menu'
import { vocabForState } from './stateVocabulary'
import './pipeline.css'

interface PipelineStripProps {
  /** Блоки, которые реализует текущий экран (подсвечиваются). */
  activeBlocks?: readonly BlockId[]
}

const ABNORMAL = new Set(['error', 'stale', 'unconfigured'])

/**
 * Подпись ячейки — полное слово без сокращений (владелец: «РАСПРЕД.», «ВНУТР.», «МОНИТ.» — нечитаемо);
 * полное имя блока — в подсказке и на карте.
 */
const STRIP_NAME: Readonly<Record<BlockId, string>> = {
  external: 'Условия',
  distributions: 'Распределения',
  internal: 'Внутренние',
  decisions: 'Решения',
  criteria: 'Критерии',
  agents: 'Агенты',
  monitoring: 'Мониторинг',
  llm: 'MENTAT',
}

/** Вторая строка ячейки: у отклонений — «слово: причина», у текущих блоков — бейдж. */
function secondLine(l: NodeLive, current: boolean): string | null {
  const word = vocabForState(l.state).word
  if (ABNORMAL.has(l.state)) return `${word}: ${l.detail ?? l.reason ?? l.badge ?? 'см. карту'}`
  return current ? l.badge ?? word : null
}

export interface CellLink {
  href: string | null
  /** Ячейка ведёт на вкладку открытого экрана (а не на карту или другой экран). */
  tab: boolean
}

/**
 * Куда ведёт ячейка: блок текущего экрана, у которого на этом экране есть своя вкладка, — на эту
 * вкладку (открытый сценарий сохраняется); прочие блоки текущего экрана — на узел карты;
 * остальные — на экран-владелец (у [8] — `null`, это действие). Чистая функция — vitest.
 */
export function cellLink(block: BlockId, current: boolean, route: { screenId: string; anchor: string | null }): CellLink {
  const home = BLOCK_HOME[block]
  if (current && home.kind === 'route' && home.anchor && route.screenId === home.screen) {
    if (home.screen === 'scenarios') {
      const r = parseScenarioAnchor(route.anchor)
      return { href: buildHash('scenarios', r.compare ? home.anchor : joinAnchor(r.id, home.anchor)), tab: true }
    }
    return { href: buildHash(home.screen, home.anchor), tab: true }
  }
  return { href: blockHref(block, current), tab: false }
}

export function PipelineStrip({ activeBlocks = [] }: PipelineStripProps) {
  const { state, scenario } = useMethodMapState()
  const route = useHashRoute()
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
            const link = cellLink(b.id, current, route)
            const where = link.tab ? 'открыть вкладку' : current ? 'на карте ↗' : home.kind === 'action' ? `открыть ${home.label} ↗` : `${home.label} ↗`
            const title = `[${b.n}] ${b.title} — ${v.word}${l.badge ? `: ${l.badge}` : ''}${l.reason ? ` · ${l.reason}` : ''} · ${where}`
            const body = (
              <>
                <span className="pstrip__n mono">{b.n}</span>
                <span className="pstrip__text">
                  <span className="pstrip__name">{STRIP_NAME[b.id] ?? b.title}</span>
                  {line && <span className="pstrip__badge">{line}</span>}
                </span>
                <StateGlyph state={l.state} />
              </>
            )
            return (
              <li key={b.id} className={`pstrip__cell is-${l.state}${current ? ' is-current' : ''}`} style={{ '--block': b.colorVar } as CSSProperties}>
                {link.href !== null ? (
                  <a href={link.href} className="pstrip__link" aria-current={current ? 'location' : undefined} title={title}>{body}</a>
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
  if (scenarioName) parts.push({ key: 'sc', text: `сценарий «${scenarioName}»`, href: '#/scenarios' })
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
  const last = parts[parts.length - 1]
  const anyStale = parts.some((p) => p.stale)
  const chain = parts.map((p) => `${p.text}${p.stale ? ' (устарело)' : ''}`).join(' → ')
  const items: MenuItem[] = parts.map((p) => ({
    id: p.key,
    label: <span className="pstrip__item">{p.text}{p.stale && <span className="pstrip__stale"><span className="mm-glyph mm-glyph--stale" aria-hidden="true" /> устарело</span>}</span>,
    hint: p.stale ? `устарело: ${p.stale}` : undefined,
    onSelect: () => { window.location.hash = p.href.replace(/^#/, '') },
  }))
  return (
    <div className="pstrip__lineage" title={`Родословная результата: ${chain}`}>
      <Menu items={items} label={`Родословная результата: ${chain}`} icon={null} size="sm" align="end">
        <span className="pstrip__lin">{last.text}</span>
        {anyStale && <span className="pstrip__stale"><span className="mm-glyph mm-glyph--stale" aria-hidden="true" /> устарело</span>}
        <span className="pstrip__caret" aria-hidden="true">▾</span>
      </Menu>
    </div>
  )
}
