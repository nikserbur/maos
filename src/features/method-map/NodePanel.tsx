/**
 * Боковая панель узла (UX-V2 §3.6, X2 P-120/P-126/P-128) — от обзора к деталям. Блок: сводка в одну
 * строку со ссылкой на подблок, который тянет блок вниз → Подблоки → Входы и выходы → «Параметры (N)»
 * свёрнуто и по подблокам. Подблок и лист: «что это» → формула с живой подстановкой (InfoTipContent) →
 * паспорт → содержимое → входы и выходы. Сырой текст сервера — только в «Подробнее». Действия — липкий
 * подвал: один primary «Открыть «Экран» →» (для MENTAT — открыть панель), запуск, «Методика», MENTAT.
 */
import { useId, type CSSProperties } from 'react'
import { dateTime } from '../../explain/format'
import { getDiagram } from '../../diagrams'
import { methodologyHref } from '../../explain/anchors'
import { getMetric } from '../../explain/metrics'
import { useDecisionContext } from '../../shell/context'
import { buildHash, joinAnchor } from '../../shell/router'
import { Icon } from '../../shell/icons'
import { overlayActions } from '../../shell/overlays'
import { screenTitle } from '../../shell/screens'
import { InfoTipContent } from '../../ui/InfoTip'
import { blockTag, blockOf } from './blocks'
import { liveOf, worstSubblock } from './deriveState'
import { EdgeRow, KIND_LABEL, NodeRow, PanelSection } from './NodeRows'
import { PassportCard, PassportTable } from './PassportTable'
import { childrenOf, edgesOf, getNode, pathOf, screenFor, subblocksOf } from './registry'
import { STAGE_LABEL, STATE_META } from './stateMeta'
import { StateChip, StateGlyph } from './StateGlyph'
import type { MapNode, MethodMapState, ParameterPassport, ScreenLink } from './types'

const ACTION_LABEL: Record<Exclude<NonNullable<MapNode['action']>, 'mentat'>, string> = {
  optimize: 'Рассчитать портфель', schedule: 'Построить план', forecast: 'Пересчитать прогноз',
  estimate: 'Оценить по данным', cash: 'Рассчитать кассу', train: 'Обучить политику',
}

interface NodePanelProps {
  nodeId: string
  live: MethodMapState
  onClose: () => void
  onSelect: (id: string) => void
}

const paramsOf = (nodes: readonly MapNode[], live: MethodMapState): ParameterPassport[] =>
  nodes.filter((n) => n.kind === 'parameter' && n.paramId && live.params[n.paramId]).map((n) => live.params[n.paramId!])

/** Параметры узла: дети подблока или входы формулы (у блока — по подблокам, см. BlockParams). */
function passportsFor(node: MapNode, live: MethodMapState): ParameterPassport[] {
  if (node.kind === 'subblock') return paramsOf(childrenOf(node.id), live)
  if (node.kind !== 'formula') return []
  const inputs = edgesOf(node.id).incoming.filter((e) => e.kind === 'param').map((e) => getNode(e.from)).filter((n): n is MapNode => Boolean(n))
  return paramsOf(inputs, live)
}

/** Адрес экрана узла: раздел результата плана — по плану из контекста, иначе история планов. */
function screenHref(link: ScreenLink, planId: string | undefined): string {
  if (link.runSection) return buildHash(link.id, planId ? joinAnchor('run', planId, link.runSection) : undefined)
  return buildHash(link.id, link.anchor)
}

/** «Параметры (N)» блока — свёрнуто, по подблокам. */
function BlockParams({ node, live }: { node: MapNode; live: MethodMapState }) {
  const groups = subblocksOf(node.block).map((s) => ({ sub: s, params: paramsOf(childrenOf(s.id), live) })).filter((g) => g.params.length > 0)
  const total = groups.reduce((n, g) => n + g.params.length, 0)
  if (total === 0) return null
  return (
    <details className="mm-panel__sec mm-panel__more">
      <summary className="mm-panel__label text-caps">Параметры ({total})</summary>
      {groups.map((g) => (
        <div key={g.sub.id} className="mm-panel__group">
          <p className="mm-panel__group-title">{g.sub.title}</p>
          <PassportTable passports={g.params} />
        </div>
      ))}
    </details>
  )
}

/** Сводка блока в одну строку: состояние и подблок, который его определяет. */
function BlockSummary({ node, live, onSelect }: { node: MapNode; live: MethodMapState; onSelect: (id: string) => void }) {
  const l = liveOf(live, node.id)
  const worst = worstSubblock(live, node.block)
  const wl = worst ? liveOf(live, worst.id) : undefined
  return (
    <p className="mm-panel__summary">
      <StateGlyph state={l.state} />
      <span>{STATE_META[l.state].label}</span>
      {worst && (
        <>
          <span aria-hidden="true">·</span>
          <button type="button" className="mm-link" onClick={() => onSelect(worst.id)}>{worst.title}</button>
          {wl?.badge && <span className="mm-panel__summary-badge">{wl.badge}</span>}
        </>
      )}
    </p>
  )
}

export function NodePanel({ nodeId, live, onClose, onSelect }: NodePanelProps) {
  const titleId = useId()
  const ctx = useDecisionContext()
  const node = getNode(nodeId)
  if (!node) return null
  const l = liveOf(live, nodeId)
  const block = blockOf(node.block)
  const isBlock = node.kind === 'block'
  const path = pathOf(nodeId)
  const metric = node.metricId ? getMetric(node.metricId) : undefined
  const passport = node.paramId ? live.params[node.paramId] : undefined
  const passports = passportsFor(node, live)
  const kids = isBlock ? [] : childrenOf(nodeId).filter((k) => k.kind !== 'parameter' || !passports.length)
  const { incoming, outgoing } = edgesOf(nodeId)
  const diagram = getDiagram(node.diagram)
  const screen = screenFor(node)
  const stage = node.stage ?? (isBlock ? undefined : getNode(node.parent ?? '')?.stage)
  const planned = Boolean(stage && stage !== 'done')
  const updated = l.updatedAt ? dateTime(l.updatedAt) : null
  // [8] и узел MENTAT открывают панель MENTAT (как ячейка [8] полосы), а не экран.
  const opensMentat = node.action === 'mentat' || node.id === 'llm'
  const reasonGlyph = l.state === 'error' || l.state === 'stale' || l.state === 'unconfigured'

  return (
    <aside className="mm-panel" aria-labelledby={titleId} style={{ '--block': block.colorVar } as CSSProperties}>
      <div className="mm-panel__scroll">
        <div className="mm-panel__top">
          {path.length > 1 && (
            <nav className="mm-panel__crumbs" aria-label="Путь к узлу">
              {path.slice(0, -1).map((p, i) => (
                <span key={p.id}>
                  {i > 0 && <span className="mm-panel__sep" aria-hidden="true">›</span>}
                  <button type="button" className="mm-link" onClick={() => onSelect(p.id)}>{p.kind === 'block' ? `${blockTag(p.block)} ${blockOf(p.block).title}` : p.title}</button>
                </span>
              ))}
            </nav>
          )}
          <button type="button" className="btn btn--ghost btn--icon mm-panel__close" onClick={onClose} aria-label="Закрыть панель (Esc)" title="Закрыть (Esc)">
            <Icon name="close" size={16} />
          </button>
        </div>

        <header className="mm-panel__head">
          {!isBlock && <p className="mm-panel__kind text-caps">{KIND_LABEL[node.kind]}</p>}
          <h2 id={titleId} className="mm-panel__title">{isBlock ? <><span className="mm-panel__n mono">{blockTag(node.block)}</span> {block.title}</> : node.title}</h2>
          <div className="mm-panel__chips">
            {planned ? <span className="mm-chip mm-chip--stage">{STAGE_LABEL[stage!]}</span> : <StateChip state={l.state}>{l.status === 'синтетика' ? 'синтетика' : undefined}</StateChip>}
            {updated && <span className="mm-panel__updated num">обновлено {updated}</span>}
          </div>
          {isBlock
            ? <BlockSummary node={node} live={live} onSelect={onSelect} />
            : (l.badge || l.detail) && <p className="mm-panel__badge">{[l.badge, l.detail].filter(Boolean).join(' · ')}</p>}
          {l.reason && <p className="mm-panel__reason">{reasonGlyph && <StateGlyph state={l.state} />}{l.reason}</p>}
          {l.state !== 'estimated' && l.state !== 'calibrated' && <p className="mm-panel__hint">{STATE_META[l.state].hint}</p>}
          {l.raw && (
            <details className="mm-panel__raw">
              <summary>Подробнее</summary>
              <pre className="mono">{l.raw}</pre>
            </details>
          )}
        </header>

        {node.short && node.kind !== 'formula' && <p className="mm-panel__short">{isBlock ? block.summary : node.short}</p>}

        {isBlock && (
          <PanelSection title="Подблоки">
            <ul className="mm-list">
              {subblocksOf(node.block).map((k) => <NodeRow key={k.id} node={k} live={live} onSelect={onSelect} />)}
            </ul>
          </PanelSection>
        )}

        {metric && (
          <PanelSection title="Формула">
            <div className="mm-panel__formula">
              <InfoTipContent entry={metric} values={live.values[nodeId]} titleId={`${titleId}-f`} />
            </div>
            {!live.values[nodeId] && <p className="mm-panel__muted">Живых значений нет: расчёт ещё не выполнялся.</p>}
          </PanelSection>
        )}

        {passport && (
          <PanelSection title="Паспорт">
            <PassportCard passport={passport} />
          </PanelSection>
        )}

        {passports.length > 0 && (
          <PanelSection title={node.kind === 'formula' ? 'Входы формулы' : `Параметры (${passports.length})`}>
            <PassportTable passports={passports} onPick={(pid) => {
              const target = childrenOf(nodeId).find((c) => c.paramId === pid) ?? edgesOf(nodeId).incoming.map((e) => getNode(e.from)).find((n) => n?.paramId === pid)
              if (target) onSelect(target.id)
            }} />
          </PanelSection>
        )}

        {kids.length > 0 && (
          <PanelSection title="Содержимое">
            <ul className="mm-list">
              {kids.map((k) => <NodeRow key={k.id} node={k} live={live} onSelect={onSelect} />)}
            </ul>
          </PanelSection>
        )}

        {(incoming.length > 0 || outgoing.length > 0) && (
          <PanelSection title="Входы и выходы">
            <ul className="mm-list">
              {incoming.map((e) => <EdgeRow key={e.id} edge={e} dir="in" onSelect={onSelect} />)}
              {outgoing.map((e) => <EdgeRow key={e.id} edge={e} dir="out" onSelect={onSelect} />)}
            </ul>
          </PanelSection>
        )}

        {isBlock && <BlockParams node={node} live={live} />}

        {node.dataset && (
          <PanelSection title="Данные">
            <p className="mm-panel__muted">таблица <span className="mono">{node.dataset.table}</span>{node.dataset.registry ? ' · справочник на экране «Справочники»' : ''}</p>
          </PanelSection>
        )}

        {diagram && !metric && !isBlock && (
          <figure className="mm-panel__diagram">
            <diagram.Component compact />
            <figcaption>{diagram.title}</figcaption>
          </figure>
        )}
      </div>

      <footer className="mm-panel__actions">
        {opensMentat
          ? <button type="button" className="btn btn--primary" onClick={() => overlayActions.askMentat(node.id)}><Icon name="sparkle" size={14} /> Открыть MENTAT</button>
          : <a className="btn btn--primary" href={screenHref(screen, ctx.planId)}>Открыть «{screenTitle(screen.id)}» →</a>}
        {node.action && node.action !== 'mentat' && !planned && (
          <a className="btn" href={screenHref(screen, ctx.planId)} title="Запуск выполняется на экране">
            <Icon name="play" size={14} /> {ACTION_LABEL[node.action]}
          </a>
        )}
        {node.learnMore && !metric && <a className="btn btn--ghost" href={methodologyHref(node.learnMore)}>Как считается — «Методика»</a>}
        {!opensMentat && (
          <button type="button" className="btn btn--ghost" onClick={() => overlayActions.askMentat(node.id)}
            title="MENTAT: «почему так» по графу расчёта вокруг этого узла (Cmd/Ctrl+J)">
            <Icon name="sparkle" size={14} /> Спросить MENTAT
          </button>
        )}
      </footer>
    </aside>
  )
}
