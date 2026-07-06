import type { Machine, Worker, WorkCenterType } from '../../lib/api'

/** Допущен ли рабочий к типу РЦ — зеркалит логику планировщика
 *  (Scheduler.cpp): пустые навыки = универсал; иначе токен = имя/ID типа
 *  (регистронезависимо, с подстрокой для длинных токенов). */
export function isEligible(skills: string, typeName: string, typeId: string): boolean {
  const sk = (skills || '').trim()
  if (!sk) return true // универсал — допущен ко всему
  const toks = sk.toLowerCase().split(',').map((s) => s.trim()).filter(Boolean)
  const nm = typeName.toLowerCase()
  const idl = typeId.toLowerCase()
  return toks.some((t) => t === nm || t === idl || (t.length > 3 && nm.includes(t)))
}

export interface LaborLoad {
  typeId: string
  typeName: string
  machines: number   // единиц оборудования этого типа
  operators: number  // рабочих, допущенных к типу
  cap: number        // реальный параллелизм = min(станки, операторы)
}

/**
 * По каждому типу РЦ: сколько станков против скольких допущенных операторов.
 * Реальный параллелизм ограничен min(станки, операторы) — если операторов
 * меньше, лишние станки простаивают в ожидании рабочего.
 */
export function laborLoads(
  machines: Machine[],
  workers: Worker[],
  wcTypes: WorkCenterType[],
): LaborLoad[] {
  return wcTypes
    .map((t) => {
      const nMach = machines.filter((m) => m.wc_type_id === t.id).length
      const nOps = workers.filter((w) => isEligible(w.skills, t.name, t.id)).length
      return { typeId: t.id, typeName: t.name, machines: nMach, operators: nOps, cap: Math.min(nMach, nOps) }
    })
    .filter((l) => l.machines > 0)
}

/** Типы, где операторов МЕНЬШЕ, чем станков (узкое место по труду). */
export function laborBottlenecks(
  machines: Machine[],
  workers: Worker[],
  wcTypes: WorkCenterType[],
): LaborLoad[] {
  return laborLoads(machines, workers, wcTypes).filter((l) => l.operators < l.machines)
}
