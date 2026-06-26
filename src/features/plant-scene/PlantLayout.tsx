import { FlowLinks } from './FlowLinks'
import { StageObject } from './StageObject'
import { STAGES } from './layout'

interface PlantLayoutProps {
  selectedId: string | null
  onSelect: (id: string) => void
}

/** Полная раскладка предприятия: потоки + узлы. */
export function PlantLayout({ selectedId, onSelect }: PlantLayoutProps) {
  return (
    <group>
      <FlowLinks />
      {STAGES.map((stage) => (
        <StageObject
          key={stage.id}
          stage={stage}
          selected={stage.id === selectedId}
          onSelect={onSelect}
        />
      ))}
    </group>
  )
}
