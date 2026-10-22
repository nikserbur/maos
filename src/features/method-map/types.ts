/**
 * Типы «Карты методологии» (docs/UX-V2.md §3.9): статический реестр узлов/рёбер
 * восьми канонических блоков (PLAN-V2 §3) и живое состояние для текущего контекста.
 * Реестр — только данные; состояние пока строит фронтенд (`deriveState.ts`),
 * позже — `GET /api/method-map/state` с тем же контрактом.
 */
import type { DiagramId } from '../../diagrams'
import type { Unit } from '../../explain/format'
import type { MethodologyAnchor } from '../../explain/types'

export type BlockId =
  | 'external' | 'distributions' | 'internal' | 'decisions'
  | 'criteria' | 'agents' | 'monitoring' | 'llm'

/** Канонический порядок блоков [1]…[8]. */
export const BLOCK_IDS: readonly BlockId[] = [
  'external', 'distributions', 'internal', 'decisions', 'criteria', 'agents', 'monitoring', 'llm',
]

export type MapNodeKind = 'block' | 'subblock' | 'parameter' | 'formula' | 'dataset' | 'screen'

export type NodeState =
  | 'unconfigured' | 'default' | 'manual' | 'estimated' | 'calibrated'
  | 'normative' | 'stale' | 'error' | 'planned'

/**
 * Происхождение значения — паспорт параметра (PLAN-V2 §2.5; A2 «наблюдение/оценка/калибровка/норматив»).
 * Волна G2: `ui` — подобрано для интерфейса (статус «UI» серверного паспорта), `synthetic` — синтетические
 * данные (`synthetic = 1`, запрет в обучении). Статусы [К] и [НОРМ] никогда не подписываются «оценено».
 */
export type Provenance = 'observed' | 'estimated' | 'calibrated' | 'normative' | 'manual' | 'default' | 'ui' | 'synthetic'

/** Единицы паспорта: реестр «i» + единицы внешних условий. */
export type ParamUnit = Unit | '×' | '%/год' | '%/мес' | 'п.п.' | 'дн' | 'прогонов' | 'мес'

export type ParamOwner = 'project' | 'scenario' | 'run'

/** Честная граница реализации — та же шкала, что чипы «Методики». */
export type Stage = 'done' | 'w1' | 'w2' | 'w3'

export interface ScreenLink {
  id: string
  anchor?: string
  field?: string
}

/** Статическая часть паспорта: что это за величина, где живёт, чем ограничена. */
export interface ParamDef {
  id: string
  label: string
  unit: ParamUnit
  owner: ParamOwner
  /** Разумный диапазон для UI (вне — предупреждение, не запрет). */
  range?: [number, number]
  step?: number
  editable: boolean
  screen?: ScreenLink
  /** «коэффициент подобран для заметности» и т. п. */
  note?: string
  /** Происхождение, пока пользователь не задал значение. */
  provenance: Provenance
  /** Значение по умолчанию кода/НСИ (null — задаёт бэкенд). */
  defaultValue?: number | string | null
  stage?: Stage
  /** Код строки серверного паспорта (GET /api/passport): статус, источник, note. */
  passportCode?: string
  /** Поле принимается API, но в расчёте не используется (волна M: ползунки → режимы). */
  deprecated?: boolean
}

export interface ParameterPassport {
  id: string
  label: string
  unit: ParamUnit
  value: number | string | null
  provenance: Provenance
  owner: ParamOwner
  source?: { dataset: string; n: number; from?: string; to?: string; method?: string }
  ci?: [number, number]
  range?: [number, number]
  step?: number
  estimatedAt?: string
  validUntil?: string
  editable: boolean
  screen?: ScreenLink
  note?: string
  /** Значение вне разумного диапазона. */
  outOfRange?: boolean
  stage?: Stage
  /** Серверный паспорт: статус Н/О/К/НОРМ/UI/техн./синтетика, источник, файл, обновлено. */
  status?: string
  passportCode?: string
  sourceText?: string
  fileRef?: string
  deprecated?: boolean
}

export type NodeShape = 'disc' | 'triangle' | 'square' | 'point'

export interface MapNode {
  id: string
  kind: MapNodeKind
  block: BlockId
  parent?: string
  title: string
  short?: string
  /** Только formula: id из src/explain/metrics. */
  metricId?: string
  /** Только parameter: id паспорта (PARAMS). */
  paramId?: string
  /** Только dataset: имя таблицы/ряда и реестр НСИ. */
  dataset?: { table: string; registry?: string }
  screen?: ScreenLink
  diagram?: DiagramId
  learnMore?: MethodologyAnchor
  stage?: Stage
  /** Запускаемое действие подблока. */
  action?: 'optimize' | 'schedule' | 'forecast' | 'estimate' | 'cash' | 'train'
  /** Грамматика A6 §6: ● система / ▲ решение / ■ ресурс / · событие. */
  shape?: NodeShape
  /** Фиксированные координаты L0 (единицы сетки 8 px). */
  pos?: { x: number; y: number; w?: number; h?: number }
}

export type MapEdgeKind = 'data' | 'param' | 'feedback' | 'control' | 'explain'

export interface MapEdge {
  id: string
  from: string
  to: string
  kind: MapEdgeKind
  label?: string
  /** Имя поля контракта API, которым передаётся связь (показывается при наведении). */
  payload?: string
}

export interface MethodMapRegistry {
  version: string
  nodes: readonly MapNode[]
  edges: readonly MapEdge[]
}

export interface DecisionContextRef {
  scenarioId?: string
  portfolioRunId?: string
  planId?: string
  scheduleRunId?: string
  cashRunId?: string
}

export interface NodeLive {
  state: NodeState
  /** «оценено 12/14», «CVaR −1,2 млн ₽». */
  badge?: string
  /** Вторая строка бейджа (приглушённо). */
  detail?: string
  value?: number | string
  unit?: ParamUnit
  updatedAt?: string
  /** Ошибки валидации / причина stale. */
  reason?: string
}

/** Живое состояние для контекста (контракт будущего GET /api/method-map/state). */
export interface MethodMapState {
  context: DecisionContextRef
  computedAt: string
  /** Откуда состояние: бэкенд или фронтовая оценка по последним ответам. */
  source: 'backend' | 'derived'
  nodes: Record<string, NodeLive>
  params: Record<string, ParameterPassport>
  /** Живые значения для формул: nodeId → значения плейсхолдеров `InfoTip`. */
  values: Record<string, Readonly<Record<string, number | string | null | undefined>>>
  edges?: Record<string, { magnitude?: number; label?: string; active?: boolean }>
  run?: { nodeId: string; phase: string; progress: number; startedAt: string }
}
