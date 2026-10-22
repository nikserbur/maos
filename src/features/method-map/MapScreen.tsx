/**
 * Экран «Карта методологии» `#/map[/<nodeId>]` (UX-V2 §3): L0-граф восьми блоков с
 * состояниями из `deriveState()`, боковая панель узла, поиск («/»), «вписать» (F),
 * фокус на блок (1…8), подсказка клавиш (?), живой регион для смены состояния.
 * На узких экранах — вертикальный список блоков; панель — полноэкранный лист.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { setDecisionContext } from '../../shell/context'
import { Icon } from '../../shell/icons'
import { Modal } from '../../shell/Modal'
import { useHashRoute } from '../../shell/router'
import { ErrorBanner, StatusChip } from '../optimization/kit/kit'
import { MapCanvas, focusNode } from './MapCanvas'
import { MapList } from './MapList'
import { NodePanel } from './NodePanel'
import { blockTag } from './blocks'
import { L0_EDGES } from './edges'
import { getNode, searchNodes } from './registry'
import { STATE_META } from './stateMeta'
import { StateGlyph } from './StateGlyph'
import { BLOCK_IDS, type MapEdgeKind, type NodeState } from './types'
import { useMethodMapState } from './useMethodMapState'
import '../optimization/kit/kit.css'
import './map.css'

const NARROW = '(max-width: 959px)'
const EDGE_LEGEND: ReadonlyArray<{ kind: MapEdgeKind; label: string }> = [
  { kind: 'data', label: 'данные' }, { kind: 'feedback', label: 'обратная связь' },
  { kind: 'control', label: 'управление' }, { kind: 'explain', label: 'объяснение' },
]
const STATE_LEGEND: readonly NodeState[] = ['estimated', 'manual', 'normative', 'default', 'stale', 'unconfigured', 'error', 'planned']
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

const isTyping = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)

export function MapScreen() {
  const { anchor, navigate } = useHashRoute()
  const { state, refs, scenario, scenarioId, refresh } = useMethodMapState()
  const narrow = useNarrow()
  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const [fitToken, setFitToken] = useState(0)
  const [help, setHelp] = useState(false)
  const [query, setQuery] = useState('')
  const [zoom, setZoom] = useState(1)

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

  // Горячие клавиши экрана — вне полей ввода и модалок.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === '/') { e.preventDefault(); searchRef.current?.focus(); return }
      if (e.key === '?') { e.preventDefault(); setHelp((h) => !h); return }
      if (e.key === 'f' || e.key === 'F' || e.key === 'а' || e.key === 'А') { e.preventDefault(); setFitToken((t) => t + 1); return }
      if (e.key === 'Escape' && selectedId && !help) { close(); return }
      const n = Number(e.key)
      if (n >= 1 && n <= 8) { e.preventDefault(); focusNode(rootRef.current, BLOCK_IDS[n - 1]) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedId, help, close])

  const results = useMemo(() => searchNodes(query, 8), [query])
  const pickResult = (id: string) => {
    setQuery('')
    select(id)
    focusNode(rootRef.current, getNode(id)?.kind === 'block' ? id : getNode(id)!.block)
  }

  const liveText = selected
    ? `${selected.kind === 'block' ? `Блок ${blockTag(selected.block).slice(1, -1)}` : selected.title}: ${STATE_META[state.nodes[selected.id]?.state ?? 'unconfigured'].label}${state.nodes[selected.id]?.badge ? ` · ${state.nodes[selected.id]!.badge}` : ''}`
    : ''

  return (
    <div ref={rootRef} className={`mm${selectedId ? ' has-panel' : ''}`}>
      <header className="mm-bar">
        <div className="mm-bar__title">
          <p className="text-caps mm-bar__eyebrow">Объяснение · карта из 8 блоков</p>
          <h1 className="mm-bar__h">Карта методологии</h1>
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
            placeholder="Поиск узла: alpha, CVaR, ставка… (/)"
            aria-label="Поиск узла карты"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && results[0]) pickResult(results[0].id)
              if (e.key === 'Escape') { setQuery(''); (e.target as HTMLInputElement).blur() }
            }}
          />
          {results.length > 0 && (
            <ul className="mm-bar__results" role="listbox" aria-label="Результаты поиска">
              {results.map((n) => (
                <li key={n.id} role="option" aria-selected={false}>
                  <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pickResult(n.id)}>
                    <StateGlyph state={state.nodes[n.id]?.state ?? 'unconfigured'} />
                    <span className="mono mm-bar__tag">{blockTag(n.block)}</span>
                    <span>{n.title}</span>
                    <span className="mm-bar__kind">{n.kind}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="mm-bar__tools">
          <StatusChip tone={refs.status === 'error' ? 'setup' : 'idle'} title="Состояние оценено фронтендом по последним ответам API (deriveState); бэкенд-состояние появится в G3">
            {state.source === 'derived' ? 'оценено по последним ответам' : 'бэкенд'}
          </StatusChip>
          <span className="mm-bar__zoom num" aria-live="off">{Math.round(zoom * 100)} %</span>
          <button type="button" className="btn btn--ghost" onClick={() => setFitToken((t) => t + 1)} title="Вписать карту (F)">Вписать</button>
          <button type="button" className="btn btn--ghost btn--icon" onClick={refresh} title="Обновить справочники" aria-label="Обновить справочники">
            <Icon name="shuffle" size={16} />
          </button>
          <button type="button" className="btn btn--ghost btn--icon" onClick={() => setHelp(true)} title="Клавиши (?)" aria-label="Подсказка по клавишам">
            <Icon name="info" size={16} />
          </button>
        </div>
      </header>

      {refs.status === 'error' && <ErrorBanner tone="setup" onRetry={refresh}>{refs.error}: карта показывает состояние по последним ответам.</ErrorBanner>}
      {refs.status === 'ready' && refs.scenarios.length === 0 && (
        <div className="mm-note dk-rise" role="status">
          <StateGlyph state="unconfigured" />
          Нет сценария: блоки [1] и [2] пунктиром. <a className="mm-link" href="#/scenarios">Создать сценарий →</a>
        </div>
      )}
      {refs.status === 'ready' && refs.counts.machines === 0 && (
        <div className="mm-note dk-rise" role="status">
          <StateGlyph state="unconfigured" />
          Нет справочников — начните со «Справочников»: типы РЦ, станки, изделия, техкарты. <a className="mm-link" href="#/nsi">Открыть →</a>
        </div>
      )}

      <div className="mm-body">
        {narrow
          ? <MapList live={state} selectedId={selectedId} onSelect={select} />
          : (
            <MapCanvas
              live={state}
              selectedId={selectedId}
              expanded={expanded}
              fitToken={fitToken}
              onSelect={select}
              onToggle={toggle}
              onPickEdge={(edgeId) => { const e = L0_EDGES.find((x) => x.id === edgeId); if (e) select(e.to) }}
              onZoomChange={setZoom}
            />
          )}
        {selectedId && <NodePanel key={selectedId} nodeId={selectedId} live={state} onClose={close} onSelect={select} />}
      </div>

      <footer className="mm-legend" aria-label="Легенда">
        <span className="mm-legend__group">
          {STATE_LEGEND.map((s) => (
            <span key={s} className="mm-legend__item"><StateGlyph state={s} />{STATE_META[s].label}</span>
          ))}
        </span>
        <span className="mm-legend__group">
          {EDGE_LEGEND.map((e) => (
            <span key={e.kind} className="mm-legend__item"><i className={`mm-legend__edge mm-legend__edge--${e.kind}`} aria-hidden="true" />{e.label}</span>
          ))}
        </span>
        <span className="mm-legend__ctx num">
          контекст: {scenario ? `сценарий «${scenario.name}»` : 'без сценария'}{state.context.portfolioRunId ? ` · портфель ${state.context.portfolioRunId.slice(0, 8)}` : ''}
        </span>
      </footer>

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
