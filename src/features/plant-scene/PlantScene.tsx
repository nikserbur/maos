import { Suspense, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { Loader } from '@react-three/drei'
import { SceneEnvironment } from './SceneEnvironment'
import { PlantLayout } from './PlantLayout'
import { Inspector } from './Inspector'
import { STAGE_BY_ID } from './layout'
import { FLOW_META, STATUS_META } from './types'

import './scene.css'

/** Легенда статусов и типов потоков. */
function Legend() {
  return (
    <div className="legend" aria-hidden>
      <div className="legend__group">
        <div className="legend__title">Статус</div>
        {Object.values(STATUS_META).map((meta) => (
          <div className="legend__row" key={meta.label}>
            <span className="legend__dot" style={{ background: meta.color }} />
            {meta.label}
          </div>
        ))}
      </div>
      <div className="legend__group">
        <div className="legend__title">Поток</div>
        {Object.values(FLOW_META).map((meta) => (
          <div className="legend__row" key={meta.label}>
            <span className="legend__dot" style={{ background: meta.color }} />
            {meta.label}
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * 3D-схема предприятия. Вертикальный срез фазы визуализации:
 * интерактивный граф узлов, потоки, инспектор показателей.
 */
export default function PlantScene() {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = selectedId ? STAGE_BY_ID[selectedId] : undefined

  return (
    <div className="scene">
      <div className="scene__canvas">
        <Canvas
          shadows
          dpr={[1, 2]}
          camera={{ position: [30, 24, 32], fov: 42 }}
          onPointerMissed={() => setSelectedId(null)}
        >
          <SceneEnvironment />
          <Suspense fallback={null}>
            <PlantLayout selectedId={selectedId} onSelect={setSelectedId} />
          </Suspense>
        </Canvas>

        <Loader />
        <Legend />
        <div className="scene__hint mono">
          ЛКМ — орбита и выбор · колесо — зум · ПКМ — панорама
        </div>
        {selected && <Inspector stage={selected} onClose={() => setSelectedId(null)} />}
      </div>
    </div>
  )
}
