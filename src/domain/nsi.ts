/**
 * Типы предметной области — НСИ (справочники). Контракт фронтенда с C++-ядром
 * (DTO/вью-модели). Поля соответствуют ТЗ (см. docs/REQUIREMENTS.md §1):
 * «Справочник изделий», «Справочник техкарт», «Доступные операции»,
 * «Тип оборудования», «Перечень оборудования», «Справочник и хранение станков»,
 * «Справочник рабочих», «Время выполнения операции», «Расписания и календари».
 */

export type Id = string

/* ── Изделия / BOM ───────────────────────────────────────────────────── */

export type ProductType = 'изделие' | 'сборочная единица' | 'деталь'

export interface Product {
  id: Id
  name: string
  /** Родитель в составе (null = корневое изделие). Иерархия BOM. */
  parentId: Id | null
  /** Норма применяемости в составе родителя. */
  quantity: number
  batchSize: number
  isPurchased: boolean
  okpdCode?: string
  unitId?: Id
  type?: ProductType
  description?: string
}

/* ── Техкарты / операции ─────────────────────────────────────────────── */

export type OperationType = 'Single' | 'Contractor'

export interface Operation {
  id: Id
  name: string
  /** Порядок в маршруте (технологическая последовательность). */
  order: number
  typeOperation: OperationType
  /** Допустимые типы оборудования (гибкость FJSP). */
  workCenterTypes: Id[]
  requiresWorkerSkills: Id[]
  setupRequired: boolean
  splittable: boolean
  /** Входные изделия, нужные для выполнения операции (если есть). */
  inputs?: Array<{ productId: Id; quantity: number }>
}

export interface Routing {
  routingId: Id
  /** → Product.id. */
  assembly: Id
  isDefault: boolean
  version: number
  effectiveDate: string
  operations: Operation[]
}

/* ── Оборудование ────────────────────────────────────────────────────── */

export interface WorkCenterType {
  id: Id
  name: string
  group?: string
  description?: string
  interchangeable?: boolean
}

export type MachineStatus = 'работает' | 'резерв' | 'ремонт' | 'выведен'

export interface Machine {
  id: Id
  name: string
  description?: string
  workCenterType: Id
  orgUnitId: Id
  scheduleId: Id
  status: MachineStatus
  /** Коэффициент готовности (0..1]. */
  efficiency?: number
  initialWorkingHours?: number
  // Расширенный паспорт ЕО («Справочник и хранение станков»).
  vendor?: string
  invNumber?: string
  techNumber?: string
  dateInstall?: string
  serviceLife?: number
  cost?: number
  serviceCost?: number
  techPlaceId?: Id
  /** Иерархия: агрегат → узел → станок. */
  parentId?: Id | null
}

export interface MachineLogEntry {
  machineId: Id
  date: string
  hours: number
  event: string
  cost?: number
}

/* ── Оргструктура / персонал ─────────────────────────────────────────── */

export interface OrgUnit {
  id: Id
  name: string
  parentId: Id | null
}

export type WorkerStatus = 'активен' | 'отпуск' | 'больничный' | 'уволен'

export interface Worker {
  /** Табельный номер (он же идентификатор пользователя). */
  id: Id
  firstName: string
  lastName: string
  orgUnitId: Id
  position?: string
  grade?: string
  scheduleId?: Id
  status: WorkerStatus
  costPerHour?: number
}

export interface Skill {
  id: Id
  name: string
}

export interface WorkerSkill {
  workerId: Id
  skillId: Id
  /** Уровень владения (масштабирует время/качество). */
  level: number
}

/* ── Расписания / календари ──────────────────────────────────────────── */

export interface Shift {
  scheduleId: Id
  /** День недели 1..7 или элемент шаблона. */
  dayOfWeek: number
  startTime: string
  endTime: string
  breaks: Array<{ start: string; end: string }>
  efficiency?: number
}

export type CalendarExceptionType =
  | 'праздник'
  | 'сокращённый'
  | 'доп.рабочий'
  | 'ремонт'
  | 'отпуск'

export interface CalendarException {
  date: string
  type: CalendarExceptionType
  appliesTo: 'предприятие' | 'подразделение' | 'станок' | 'рабочий'
  appliesToId?: Id
  override?: { startTime: string; endTime: string }
}

export interface Schedule {
  id: Id
  name: string
  description?: string
  /** Недельный шаблон рабочих дней. */
  pattern: string
  shifts: Shift[]
}

/* ── Нормы времени/стоимости/риска ───────────────────────────────────── */

/** Норма пары «(операция × тип оборудования)»: PERT-время, стоимость, риск. */
export interface TimeNorm {
  operation: Id
  workCenterType: Id
  minTimePerformance: number
  likelyTimePerformance: number
  maxTimePerformance: number
  setupTime: number
  timePerformanceContractor?: number
  machineRate?: number
  laborRate?: number
  setupCost?: number
  contractorCost?: number
  idleCostFactor?: number
  scrapRate?: number
  reworkTime?: number
  reworkCost?: number
  reliability?: number
}
