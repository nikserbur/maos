/**
 * Боковая панель узла (UX-V2 §3.6): хлебные крошки, заголовок с состоянием и «когда
 * обновлено», краткое «что это», формула с живой подстановкой (InfoTipContent — та же
 * вёрстка, что в «i»), параметры с паспортом, дети, входы/выходы по рёбрам, мини-схема,
 * «Открыть экран» (с контекстом решения), «Запустить», «Подробнее в Методике», MENTAT.
 */
import { useId, type CSSProperties, type ReactNode } from 'react'
import { dateTime } from '../../explain/format'
import { getDiagram } from '../../diagrams'
import { methodologyHref } from '../../explain/anchors'
import { getMetric } from '../../explain/metrics'
import { buildHash } from '../../shell/router'
import { Icon } from '../../shell/icons'
import { overlayActions } from '../../shell/overlays'
import { InfoTipContent } from '../../ui/InfoTip'
import { blockTag, blockOf } from './blocks'
import { liveOf } from './deriveState'
import { PassportCard, PassportTable } from './PassportTable'
import { childrenOf, descendantsOf, edgesOf, getNode, pathOf, screenFor } from './registry'
import { STAGE_LABEL, STATE_META } from './stateMeta'
import { StateChip, StateGlyph } from './StateGlyph'
import type { MapEdge, MapNode, MethodMapState, ParameterPassport } from './types'

const KIND_LABEL: Record<MapNode['kind'], string> = {
  block: 'блок', subblock: 'подблок', parameter: 'параметр', formula: 'формула', dataset: 'датасет', screen: 'экран',
}
const ACTION_LABEL: Record<NonNullable<MapNode['action']>, string> = {
  optimize: 'Рассчитать портфель', schedule: 'Построить план', forecast: 'Пересчитать прогноз',
  estimate: 'Оценить по данным', cash: 'Рассчитать кассу', train: 'Обучить политику',
}

interface NodePanelProps {
  nodeId: string
  live: MethodMapState
  onClose: () => void
  onSelect: (id: string) => void
}

/** Паспорта, относящиеся к узлу: сам параметр, дети подблока, входы формулы, агрегат блока. */
function passportsFor(node: MapNode, live: MethodMapState): ParameterPassport[] {
  const pick = (nodes: readonly MapNode[]) =>
    nodes.filter((n) => n.kind === 'parameter' && n.paramId && live.params[n.paramId]).map((n) => live.params[n.paramId!])
  switch (node.kind) {
    case 'block': return pick(descendantsOf(node.id))
    case 'subblock': return pick(childrenOf(node.id))
    case 'formula': {
      const inputs = edgesOf(node.id).incoming.filter((e) => e.kind === 'param').map((e) => getNode(e.from)).filter((n): n is MapNode => Boolean(n))
      return pick(inputs)
    }
    default: return []
  }
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mm-panel__sec">
      <p className="mm-panel__label text-caps">{title}</p>
      {children}
    </section>
  )
}

function NodeRow({ node, live, onSelect }: { node: MapNode; live: MethodMapState; onSelect: (id: string) => void }) {
  const l = liveOf(live, node.id)
  return (
    <li>
      <button type="button" className="mm-row" onClick={() => onSelect(node.id)}>
        <StateGlyph state={l.state} />
        <span className="mm-row__kind mono">{KIND_LABEL[node.kind]}</span>
        <span className="mm-row__title">{node.title}</span>
        {l.badge && <span className="mm-row__badge">{l.badge}</span>}
      </button>
    </li>
  )
}

function EdgeRow({ edge, dir, onSelect }: { edge: MapEdge; dir: 'in' | 'out'; onSelect: (id: string) => void }) {
  const otherId = dir === 'in' ? edge.from : edge.to
  const other = getNode(otherId)
  if (!other) return null
  return (
    <li>
      <button type="button" className={`mm-row mm-row--edge mm-row--${edge.kind}`} onClick={() => onSelect(otherId)} title={edge.payload}>
        <span className="mm-row__arrow mono">{dir === 'in' ? '←' : '→'}</span>
        <span className="mm-row__kind mono">{edge.kind}</span>
        <span className="mm-row__title">{blockTag(other.block)} {other.title}</span>
        <span className="mm-row__badge">{edge.label}</span>
      </button>
    </li>
  )
}

export function NodePanel({ nodeId, live, onClose, onSelect }: NodePanelProps) {
  const titleId = useId()
  const node = getNode(nodeId)
  if (!node) return null
  const l = liveOf(live, nodeId)
  const block = blockOf(node.block)
  const path = pathOf(nodeId)
  const metric = node.metricId ? getMetric(node.metricId) : undefined
  const passport = node.paramId ? live.params[node.paramId] : undefined
  const passports = passportsFor(node, live)
  const kids = childrenOf(nodeId)
  const { incoming, outgoing } = edgesOf(nodeId)
  const diagram = getDiagram(node.diagram)
  const screen = screenFor(node)
  const stage = node.stage ?? (node.kind === 'block' ? undefined : getNode(node.parent ?? '')?.stage)
  const updated = l.updatedAt ? dateTime(l.updatedAt) : null

  return (
    <aside className="mm-panel" aria-labelledby={titleId} style={{ '--block': block.colorVar } as CSSProperties}>
      <nav className="mm-panel__crumbs" aria-label="Путь к узлу">
        {path.map((p, i) => (
          <span key={p.id}>
            {i > 0 && <span className="mm-panel__sep" aria-hidden="true">›</span>}
            {i < path.length - 1
              ? <button type="button" className="mm-link" onClick={() => onSelect(p.id)}>{p.kind === 'block' ? blockTag(p.block) : p.title}</button>
              : <span className="mm-panel__crumb-cur">{p.kind === 'block' ? blockTag(p.block) : p.title}</span>}
          </span>
        ))}
        <button type="button" className="btn btn--ghost btn--icon mm-panel__close" onClick={onClose} aria-label="Закрыть панель (Esc)">
          <Icon name="close" size={16} />
        </button>
      </nav>

      <header className="mm-panel__head">
        <p className="mm-panel__kind text-caps">{KIND_LABEL[node.kind]} · {blockTag(node.block)} {block.title}</p>
        <h2 id={titleId} className="mm-panel__title">{node.title}</h2>
        <div className="mm-panel__chips">
          <StateChip state={l.state} />
          {stage && stage !== 'done' && <span className="mm-chip mm-chip--stage">{STAGE_LABEL[stage]}</span>}
          {updated && <span className="mm-panel__updated num">обновлено {updated}</span>}
        </div>
        {(l.badge || l.detail) && <p className="mm-panel__badge">{[l.badge, l.detail].filter(Boolean).join(' · ')}</p>}
        {l.reason && <p className={`mm-panel__reason is-${l.state}`}>{l.reason}</p>}
        <p className="mm-panel__hint">{STATE_META[l.state].hint}</p>
      </header>

      {node.short && node.kind !== 'formula' && <p className="mm-panel__short">{node.short}</p>}

      {metric && (
        <Section title="Формула">
          <div className="mm-panel__formula">
            <InfoTipContent entry={metric} values={live.values[nodeId]} titleId={`${titleId}-f`} />
          </div>
          {!live.values[nodeId] && <p className="mm-panel__muted">Живых значений нет: прогон ещё не выполнялся.</p>}
        </Section>
      )}

      {passport && (
        <Section title="Паспорт">
          <PassportCard passport={passport} />
        </Section>
      )}

      {passports.length > 0 && (
        <Section title={node.kind === 'formula' ? 'Входы формулы' : 'Параметры'}>
          <PassportTable passports={passports} />
        </Section>
      )}

      {kids.length > 0 && (
        <Section title={node.kind === 'block' ? 'Подблоки' : 'Содержимое'}>
          <ul className="mm-list">
            {kids.map((k) => <NodeRow key={k.id} node={k} live={live} onSelect={onSelect} />)}
          </ul>
        </Section>
      )}

      {(incoming.length > 0 || outgoing.length > 0) && (
        <Section title="Входы и выходы">
          <ul className="mm-list">
            {incoming.map((e) => <EdgeRow key={e.id} edge={e} dir="in" onSelect={onSelect} />)}
            {outgoing.map((e) => <EdgeRow key={e.id} edge={e} dir="out" onSelect={onSelect} />)}
          </ul>
        </Section>
      )}

      {node.dataset && (
        <Section title="Датасет">
          <p className="mm-panel__muted mono">{node.dataset.table}{node.dataset.registry ? ` · реестр ${node.dataset.registry}` : ''}</p>
        </Section>
      )}

      {diagram && !metric && (
        <figure className="mm-panel__diagram">
          <diagram.Component compact />
          <figcaption>{diagram.title}</figcaption>
        </figure>
      )}

      <footer className="mm-panel__actions">
        <a className="btn btn--primary" href={buildHash(screen.id, screen.anchor)}>Открыть экран →</a>
        {node.action && (
          <a className="btn" href={buildHash(screen.id, screen.anchor)} aria-disabled={stage && stage !== 'done' ? true : undefined}
            title={stage && stage !== 'done' ? `В плане: ${STAGE_LABEL[stage]}` : 'Запуск выполняется на экране'}>
            <Icon name="play" size={14} /> {ACTION_LABEL[node.action]}
          </a>
        )}
        {node.learnMore && !metric && <a className="btn btn--ghost" href={methodologyHref(node.learnMore)}>Подробнее в «Методике»</a>}
        <button type="button" className="btn btn--ghost" onClick={() => overlayActions.askMentat(node.id)}
          title="MENTAT: «почему так» по графу расчёта вокруг этого узла (Cmd/Ctrl+J)">
          <Icon name="sparkle" size={14} /> Спросить MENTAT
        </button>
      </footer>
    </aside>
  )
}
