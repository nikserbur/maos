/**
 * Объект, выбранный в сцене во время симуляции (X2 P-29): занятость с начала горизонта, очередь
 * и текущая операция — в правой колонке, без второй плавающей панели.
 */
import { countText, num, pct } from '../../explain/format'
import type { SimTaskDto } from '../../lib/api'
import type { SceneNode } from './graph/sceneModel'
import { BATCH_FORMS } from './sceneOps'
import { nodeSimStats } from './simModel'

interface SimNodeInfoProps {
  node: SceneNode
  tasks: ReadonlyArray<SimTaskDto>
  machineIds: ReadonlySet<string>
  t: number
}

export function SimNodeInfo({ node, tasks, machineIds, t }: SimNodeInfoProps) {
  const s = nodeSimStats(tasks, machineIds, t)
  const shop = node.refType !== 'machine'
  return (
    <section className="sim__node" aria-label={`Объект в симуляции: ${node.title}`}>
      <div className="sim__node-head">
        <span className="sim__node-k text-caps">{shop ? 'Цех' : 'Станок'}</span>
        <span className="sim__node-title">{node.title}</span>
      </div>
      <dl className="sim__node-facts">
        <div><dt>Занятость с начала</dt><dd className="num">{pct(s.busyShare, 0)}</dd></div>
        <div><dt>Очередь</dt><dd className="num">{s.queue > 0 ? countText(s.queue, BATCH_FORMS) : 'нет'}</dd></div>
        <div>
          <dt>Сейчас</dt>
          <dd>{s.current
            ? `${s.current.op_name} · ${s.current.product_name}${shop && s.active > 1 ? ` и ещё ${num(s.active - 1, 0)}` : ''}`
            : 'простаивает'}</dd>
        </div>
      </dl>
    </section>
  )
}
