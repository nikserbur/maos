import { Suspense, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { Loader } from '@react-three/drei'
import { SceneEnvironment } from './SceneEnvironment'
import { PlantLayout } from './PlantLayout'
import { Inspector } from './Inspector'
import { STAGE_BY_ID } from './layout'
import { STATUS_META } from './types'
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
        <div className="legend__row">
          <span className="legend__dot" style={{ background: '#2d72d2' }} />
          Материальный
        </div>
        <div className="legend__row">
          <span className="legend__dot" style={{ background: '#c87619' }} />
          Энергетический
        </div>
      </div>
    </div>
  )
}

/**
 * 3D-схема предприятия («цифровой двойник»). Вертикальный срез фазы
 * визуализации: интерактивный граф узлов, потоки, инспектор показателей.
 */
export default function PlantScene() {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = selectedId ? STAGE_BY_ID[selectedId] : undefined

  return (
    <div className="scene">
      <header className="scene__topbar">
        <div className="scene__brand">
          <span className="scene__logo">MAOS</span>
          <span className="scene__divider" />
          <span className="scene__screen">Схема предприятия · 3D</span>
        </div>
        <div className="scene__hint mono">
          ЛКМ — орбита и выбор узла · колесо — зум · ПКМ — панорама
        </div>
      </header>

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
        {selected && <Inspector stage={selected} onClose={() => setSelectedId(null)} />}
      </div>
    </div>
  )
}
