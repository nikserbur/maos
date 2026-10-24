/**
 * Полоса над канвасом схемы (X2 P-27, P-29, P-33, P-39). Ряд 1: режимы «Просмотр · Редактирование ·
 * Симуляция» (по уровню: на мировом уровне правка и симуляция объясняют, где они работают),
 * крошки уровней кита («Мир › Предприятие › Цех №3 · 36 станков» — имя уровня один раз),
 * инструменты: «Вписать» (F), пауза анимации, «?» управление. Ряд 2: вердикт плана и легенда.
 */
import type { ReactNode } from 'react'
import { Breadcrumbs, Segmented, type Crumb, type SegOption } from '../../ui/kit'
import { AnimationToggle } from '../../ui/motion'
import { Icon } from '../../shell/icons'
import { SceneHelp } from './SceneHelp'
import type { SceneLevel } from './InspectorEmpty'

export type SceneUiMode = 'view' | 'edit' | 'sim'

export interface ModeAvailability {
  /** Причина, по которой «Редактирование» недоступно на уровне (иначе null). */
  edit: string | null
  /** Причина, по которой «Симуляция» недоступна на уровне (иначе null). */
  sim: string | null
}

function modeOptions(av: ModeAvailability): ReadonlyArray<SegOption<SceneUiMode>> {
  return [
    { id: 'view', label: 'Просмотр', icon: 'scheme', title: 'Навигация по схеме без правок' },
    { id: 'edit', label: 'Редактирование', icon: 'gear', disabled: av.edit !== null,
      title: av.edit ?? 'Имена, расположение, связи, добавление цехов и станков — с «Отменить»' },
    { id: 'sim', label: 'Симуляция', icon: 'play', disabled: av.sim !== null,
      title: av.sim ?? 'Проиграть построенный план на 3D-схеме' },
  ]
}

interface SceneModeBarProps {
  mode: SceneUiMode
  onMode: (mode: SceneUiMode) => void
  availability: ModeAvailability
  level: SceneLevel
  crumbs: ReadonlyArray<Crumb>
  /** Счётчик уровня после крошек: «36 станков», «Предприятия (3) · склады (1)». */
  countText: string
  verdict: ReactNode
  legend: ReactNode
  onFit: () => void
}

export function SceneModeBar({ mode, onMode, availability, level, crumbs, countText, verdict, legend, onFit }: SceneModeBarProps) {
  return (
    <div className="scene__bar">
      <div className="scene__bar-row">
        <Segmented options={modeOptions(availability)} value={mode} onChange={onMode} label="Режим схемы" fit size="md" />
        <div className="scene__bar-level">
          <Breadcrumbs items={crumbs} label="Уровни схемы" className="scene__crumbs" />
          {countText && <span className="scene__bar-count">· {countText}</span>}
        </div>
        <div className="scene__bar-tools">
          {level !== 'world' && (
            <button type="button" className="btn btn--sm" onClick={onFit} aria-keyshortcuts="F" title="Вписать уровень в кадр (F)">
              <Icon name="expand" size={14} />Вписать
            </button>
          )}
          <AnimationToggle />
          <SceneHelp level={level} />
        </div>
      </div>
      <div className="scene__bar-row scene__bar-row--meta">
        <p className="scene__verdict">{verdict}</p>
        {legend}
      </div>
    </div>
  )
}
