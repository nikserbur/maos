/**
 * Пустое состояние инспектора схемы (X1 §1 п. 2): что здесь появится и что нажать —
 * EmptyState из кита, мини-легенда уровней (▣ завод / ■ цех / · станок) и клавиши.
 */
import { EmptyState } from '../../ui/kit'

type Level = 'world' | 'site' | 'shop'

const TITLE: Record<Level, string> = {
  world: 'Выберите завод на карте',
  site: 'Выберите цех на площадке',
  shop: 'Выберите станок в цехе',
}

const LEVELS: ReadonlyArray<{ id: Level; mark: string; label: string }> = [
  { id: 'world', mark: 'ep-mark--factory', label: 'завод' },
  { id: 'site', mark: 'ep-mark--shop', label: 'цех' },
  { id: 'shop', mark: 'ep-mark--machine', label: 'станок' },
]

interface InspectorEmptyProps {
  level: Level
  editing: boolean
}

export function InspectorEmpty({ level, editing }: InspectorEmptyProps) {
  return (
    <div className="ep-empty">
      <EmptyState size="sm" variant="flow" title={TITLE[level]}>
        Клик — карточка объекта: статус, показатели, оборудование из НСИ.
        {editing && ' В режиме редактирования — имя, тип и связи.'}
      </EmptyState>
      <ul className="ep-empty__levels" aria-label="Уровни схемы">
        {LEVELS.map((l) => (
          <li key={l.id} className={`ep-empty__level${l.id === level ? ' is-current' : ''}`}>
            <span className={`ep-mark ${l.mark}`} aria-hidden="true" />
            {l.label}
          </li>
        ))}
      </ul>
      <dl className="ep-empty__keys">
        <div><dt><kbd>2×ЛКМ</kbd></dt><dd>внутрь</dd></div>
        <div><dt><kbd>Esc</kbd></dt><dd>назад</dd></div>
        {level !== 'world' && <div><dt><kbd>F</kbd></dt><dd>вписать</dd></div>}
      </dl>
    </div>
  )
}
