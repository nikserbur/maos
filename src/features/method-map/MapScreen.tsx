/**
 * Экран «Карта методологии» `#/map[/<nodeId>]` (UX-V2 §3, X2 P-125/P-128/P-129/P-131): L0-граф восьми
 * блоков с состояниями из `deriveState()`, боковая панель узла (свой предохранитель ошибок), поиск («/»),
 * «вписать» (F), фокус на блок (1…8), подсказка клавиш (?), живой регион для смены состояния.
 * Шапка: что это и как читать, контекст расчёта (сценарий, портфель, время состояния); легенда —
 * поверх канваса слева сверху. На узких экранах — вертикальный список блоков; панель — лист.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { dateTimeShort, time } from '../../explain/format'
import { ErrorBoundary } from '../../shell/ErrorBoundary'
import { setDecisionContext } from '../../shell/context'
import { useEscapeLayer } from '../../shell/overlays'
import { Icon } from '../../shell/icons'
import { Modal } from '../../shell/Modal'
import { useHashRoute } from '../../shell/router'
import { ErrorBanner } from '../../ui/kit'
import { AnimationToggle } from '../../ui/motion'
import { useOptStore } from '../optimization/optStore'
import { MapCanvas, focusNode } from './MapCanvas'
import type { EdgeLabelMode } from './MapEdges'
import { MapLegend } from './MapLegend'
import { MapList } from './MapList'
import { NodePanel } from './NodePanel'
import { KIND_LABEL } from './NodeRows'
import { blockTag } from './blocks'
import { L0_EDGES } from './edges'
import { getNode, searchNodes, subblocksOf } from './registry'
import { STATE_META } from './stateMeta'
import { StateGlyph } from './StateGlyph'
import { BLOCK_IDS, type NodeState } from './types'
import { useMethodMapState } from './useMethodMapState'
import './map.css'

const NARROW = '(max-width: 959px)'
const LABELS_KEY = 'maos.map.edgeLabels'
const KEYS: ReadonlyArray<[string, string]> = [
  ['Tab / Shift+Tab', 'по блокам'], ['→ ←', 'сосед по ребру данных'], ['↓ / ↑', 'развернуть / свернуть подблоки'],
  ['Enter', 'открыть панель узла'], ['Esc', 'закрыть панель'], ['1…8', 'фокус на блок'], ['/', 'поиск узла'], ['F', 'вписать карту'], ['?', 'эта подсказка'],
]

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia(NARROW).matches)
  useEffect(() => {
    const mq = window.matchMedia(NARROW)
    const on = () => setNarrow(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return narrow
}

/** «Подписи рёбер: основные / все» — запоминается на сессию вкладки. */
function useEdgeLabels(): [EdgeLabelMode, (m: EdgeLabelMode) => void] {
  const [mode, setMode] = useState<EdgeLabelMode>(() => {
    try { return sessionStorage.getItem(LABELS_KEY) === 'all' ? 'all' : 'main' } catch { return 'main' }
  })
  const set = useCallback((m: EdgeLabelMode) => {
    setMode(m)
    try { sessionStorage.setItem(LABELS_KEY, m) } catch { /* приватный режим — только до перезагрузки */ }
  }, [])
  return [mode, set]
}

const isTyping = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)

export function MapScreen() {
  const { anchor, navigate } = useHashRoute()
  const { state, refs, scenario, scenarioId, refresh } = useMethodMapState()
  const opt = useOptStore()
  const narrow = useNarrow()
  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const [fitToken, setFitToken] = useState(0)
  const [help, setHelp] = useState(false)
  const [query, setQuery] = useState('')
  const [zoom, setZoom] = useState(1)
  const [labels, setLabels] = useEdgeLabels()

  const selectedId = anchor && getNode(anchor) ? anchor : null
  const selected = selectedId ? getNode(selectedId) : undefined
  const select = useCallback((id: string) => navigate('map', id), [navigate])
  const close = useCallback(() => navigate('map'), [navigate])
  const toggle = useCallback((block: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(block)) next.delete(block)
      else next.add(block)
      return next
    })
  }, [])

  // Выбранный подблок раскрывает свой блок, чтобы узел был виден на канвасе.
  useEffect(() => {
    if (selected && selected.kind !== 'block') setExpanded((prev) => (prev.has(selected.block) ? prev : new Set([...prev, selected.block])))
  }, [selected])

  // Панель узла — слой стека Esc: Esc закрывает её раньше MENTAT, но после подсказок, меню и модалок.
  useEscapeLayer('panel', close, Boolean(selectedId))

  // Горячие клавиши экрана — вне полей ввода и модалок.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === '/') { e.preventDefault(); searchRef.current?.focus(); return }
      if (e.key === '?') { e.preventDefault(); setHelp((h) => !h); return }
      if (e.key === 'f' || e.key === 'F' || e.key === 'а' || e.key === 'А') { e.preventDefault(); setFitToken((t) => t + 1); return }
      const n = Number(e.key)
      if (n >= 1 && n <= 8) { e.preventDefault(); focusNode(rootRef.current, BLOCK_IDS[n - 1]) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const results = useMemo(() => searchNodes(query, 8), [query])
  const pickResult = (id: string) => {
    setQuery('')
    select(id)
    focusNode(rootRef.current, getNode(id)?.kind === 'block' ? id : getNode(id)!.block)
  }

  // Легенда — только состояния, которые видны: карточки блоков и подблоки развёрнутых блоков.
  const present = useMemo<NodeState[]>(() => {
    const ids = [...BLOCK_IDS, ...BLOCK_IDS.filter((b) => expanded.has(b)).flatMap((b) => subblocksOf(b).map((s) => s.id))]
    return [...new Set(ids.map((id) => state.nodes[id]?.state ?? 'unconfigured'))]
  }, [state, expanded])
  const agentState = state.nodes['ag.rl']?.state
  const loop = agentState === 'estimated' ? 'live' : agentState === 'planned' || !agentState ? null : 'idle'

  const live = selected ? state.nodes[selected.id] : undefined
  const liveText = selected
    ? `${selected.kind === 'block' ? `Блок ${blockTag(selected.block).slice(1, -1)}` : selected.title}: ${STATE_META[live?.state ?? 'unconfigured'].label}${live?.badge ? ` · ${live.badge}` : ''}`
    : ''
  const portfolioAt = opt.result && opt.ranAt && opt.result.run_id === state.context.portfolioRunId ? opt.ranAt : null

  return (
    <div ref={rootRef} className={`mm${selectedId ? ' has-panel' : ''}`}>
      <header className="mm-bar">
        <div className="mm-bar__title">
          <p className="text-caps mm-bar__eyebrow">Объяснение · [1]–[8]</p>
          <h1 className="mm-bar__h">Карта методологии</h1>
          <p className="mm-bar__sub">Как число получается из данных: 8 блоков слева направо, петли снизу · <a className="mm-link" href="#/methodology/overview">Как читать →</a></p>
        </div>
        <label className="mm-bar__field">
          <span className="text-caps">Сценарий</span>
          <select value={scenarioId} onChange={(e) => setDecisionContext({ scenarioId: e.target.value })} aria-label="Активный сценарий">
            {refs.scenarios.length === 0 && <option value="">— нет сценариев —</option>}
            {refs.scenarios.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <div className="mm-bar__search">
          <Icon name="search" size={14} />
          <input
            ref={searchRef}
            type="search"
            value={query}
            placeholder="Поиск узла: α, CVaR, ставка… (/)"
            aria-label="Поиск узла карты"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && results[0]) pickResult(results[0].id)
              if (e.key === 'Escape' && query) { e.preventDefault(); setQuery('') }
            }}
          />
          {results.length > 0 && (
            <ul className="mm-bar__results" role="listbox" aria-label="Результаты поиска">
              {results.map((n) => (
                <li key={n.id} role="option" aria-selected={false}>
                  <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pickResult(n.id)}>
                    <StateGlyph state={state.nodes[n.id]?.state ?? 'unconfigured'} />
                    <span className="mono mm-bar__tag">{blockTag(n.block)}</span>
                    <span className="mm-bar__name">{n.title}</span>
                    <span className="mm-bar__kind">{KIND_LABEL[n.kind]}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="mm-bar__tools">
          {loop === 'live' && <AnimationToggle />}
          <span className="mm-bar__zoom num" aria-label={`Масштаб ${Math.round(zoom * 100)} %`}>{Math.round(zoom * 100)}&nbsp;%</span>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setFitToken((t) => t + 1)} title="Вписать карту (F)">Вписать</button>
          <button type="button" className="btn btn--ghost btn--sm" onClick={refresh} aria-label="Обновить данные карты" title="Перечитать справочники и состояние расчётов">Обновить</button>
          <button type="button" className="btn btn--ghost btn--icon" onClick={() => setHelp(true)} title="Клавиши (?)" aria-label="Подсказка по клавишам">
            <Icon name="info" size={16} />
          </button>
        </div>
        <p className="mm-bar__ctx">
          <span>состояние по последним расчётам · {time(state.computedAt)}</span>
          <span>{scenario ? `сценарий «${scenario.name}»` : 'без сценария'}</span>
          {state.context.portfolioRunId && (
            <span title={`прогон портфеля ${state.context.portfolioRunId}`}>{portfolioAt ? `портфель от ${dateTimeShort(portfolioAt)}` : 'портфель из контекста'}</span>
          )}
        </p>
      </header>

      {refs.status === 'error' && <ErrorBanner tone="setup" onRetry={refresh} title="Нет связи с сервером" message="Карта показывает состояние по последним ответам." detail={refs.error ?? undefined} />}
      {refs.status === 'ready' && refs.scenarios.length === 0 && (
        <div className="mm-note" role="status">
          <StateGlyph state="unconfigured" />
          Нет сценария: блоки [1] и [2] пунктиром. <a className="mm-link" href="#/scenarios">Создать сценарий →</a>
        </div>
      )}
      {refs.status === 'ready' && refs.counts.machines === 0 && (
        <div className="mm-note" role="status">
          <StateGlyph state="unconfigured" />
          Нет справочников — начните со «Справочников»: типы РЦ, станки, изделия, техкарты. <a className="mm-link" href="#/nsi">Открыть →</a>
        </div>
      )}

      <div className="mm-body">
        {narrow
          ? <MapList live={state} selectedId={selectedId} onSelect={select} />
          : (
            <div className="mm-stage">
              <MapCanvas
                live={state}
                selectedId={selectedId}
                panelOpen={Boolean(selectedId)}
                expanded={expanded}
                fitToken={fitToken}
                labels={labels}
                onSelect={select}
                onToggle={toggle}
                onPickEdge={(edgeId) => { const e = L0_EDGES.find((x) => x.id === edgeId); if (e) select(e.to) }}
                onZoomChange={setZoom}
              />
              <MapLegend present={present} labels={labels} onLabels={setLabels} loop={loop} />
            </div>
          )}
        {selectedId && (
          <ErrorBoundary key={selectedId} label="Панель узла" variant="panel" onClose={close}>
            <NodePanel nodeId={selectedId} live={state} onClose={close} onSelect={select} />
          </ErrorBoundary>
        )}
      </div>

      <div className="mm-sr" aria-live="polite" aria-atomic="true">{liveText}</div>

      {help && (
        <Modal title="Клавиши карты" onClose={() => setHelp(false)}>
          <dl className="mm-keys" style={{ '--n': KEYS.length } as CSSProperties}>
            {KEYS.map(([k, what]) => (
              <div key={k}><dt className="mono">{k}</dt><dd>{what}</dd></div>
            ))}
          </dl>
        </Modal>
      )}
    </div>
  )
}
