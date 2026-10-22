/**
 * Единая панель режимов над канвасом схемы (X1 §1 п. 6): «Просмотр · Редактирование ·
 * Симуляция» одним Segmented, справа — «Вписать» (F) и подсказка уровня. Заменяет угловую
 * кнопку «Симуляция» и селект режима в инспекторе.
 */
import { IconButton, Segmented, type SegOption } from '../../ui/kit'

export type SceneUiMode = 'view' | 'edit' | 'sim'

const MODES: ReadonlyArray<SegOption<SceneUiMode>> = [
  { id: 'view', label: 'Просмотр', icon: 'scheme', title: 'Навигация по схеме без правок' },
  { id: 'edit', label: 'Редактирование', icon: 'gear', title: 'Перемещение, связи, регистрация оборудования' },
  { id: 'sim', label: 'Симуляция', icon: 'play', title: 'Проиграть построенный план на 3D-схеме' },
]

const LEVEL_LABEL: Record<'world' | 'site' | 'shop', string> = {
  world: 'Мир — заводы и склад',
  site: 'Площадка — цеха',
  shop: 'Цех — станки',
}

interface SceneModeBarProps {
  mode: SceneUiMode
  onMode: (mode: SceneUiMode) => void
  level: 'world' | 'site' | 'shop'
  /** Кол-во узлов текущего уровня — мета справа от названия уровня. */
  count: number
  onFit: () => void
}

export function SceneModeBar({ mode, onMode, level, count, onFit }: SceneModeBarProps) {
  const canFit = level !== 'world'
  return (
    <div className="scene__bar" role="toolbar" aria-label="Режим схемы">
      <Segmented options={MODES} value={mode} onChange={onMode} label="Режим схемы" fit size="md" />
      <div className="scene__bar-level">
        <span className="scene__bar-level-name">{LEVEL_LABEL[level]}</span>
        <span className="scene__bar-level-count num">{count}</span>
      </div>
      <div className="scene__bar-tools">
        {canFit && <IconButton icon="expand" onClick={onFit} title="Вписать (F)">Вписать</IconButton>}
      </div>
    </div>
  )
}
