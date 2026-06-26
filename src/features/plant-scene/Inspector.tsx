import { STATUS_META, type PlantStage } from './types'

interface InspectorProps {
  stage: PlantStage
  onClose: () => void
}

/** Инспектор выбранного узла (правая док-панель, дизайн-система Palantir). */
export function Inspector({ stage, onClose }: InspectorProps) {
  const meta = STATUS_META[stage.status]

  return (
    <aside className="inspector" aria-label="Инспектор узла">
      <header className="inspector__head">
        <div>
          <div className="inspector__eyebrow">Узел схемы</div>
          <h2 className="inspector__title">{stage.title}</h2>
          <div className="inspector__subtitle">{stage.subtitle}</div>
        </div>
        <button className="inspector__close" onClick={onClose} aria-label="Закрыть">
          ✕
        </button>
      </header>

      <div className="inspector__status">
        <span className="inspector__status-dot" style={{ background: meta.color }} />
        <span>{meta.label}</span>
      </div>

      <div className="inspector__section-label">Показатели</div>
      <dl className="inspector__kpis">
        {stage.kpis.map((kpi) => (
          <div className="kpi" key={kpi.label}>
            <dt className="kpi__label">{kpi.label}</dt>
            <dd className="kpi__value mono">{kpi.value}</dd>
          </div>
        ))}
      </dl>

      <p className="inspector__hint">
        Данные демонстрационные. На следующих фазах узел свяжется с НСИ,
        планом и временными рядами KPI.
      </p>
    </aside>
  )
}
