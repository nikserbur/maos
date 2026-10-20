/**
 * Ресурсный слой: тип РЦ × станки × допущенные рабочие — зеркало матрицы
 * компетенций из Scheduler.cpp (load_model):
 *   skills — CSV токенов; пусто = универсал; токен допускает тип, если равен имени
 *   или id типа, либо (длина в байтах UTF-8 > 3) входит подстрокой в имя;
 *   регистр приводится ТОЛЬКО для ASCII (std::tolower), как в движке.
 *   Если допущенных нет или допущены все — движок берёт любого рабочего.
 * Эффективный параллелизм типа = min(станки, операторы) — верхняя граница:
 * один рабочий может быть допущен к нескольким типам и делится между ними.
 */
import type { ProcessData, ProcessModel, ResourceRow } from './types'

const encoder = new TextEncoder()

/** std::tolower по байтам: меняет только A–Z. */
export function asciiLower(s: string): string {
  return s.replace(/[A-Z]/g, (c) => c.toLowerCase())
}

export function parseSkills(raw: string | null | undefined): string[] {
  const out: string[] = []
  for (const tok of (raw ?? '').split(',')) {
    const t = tok.replace(/^[ \t]+|[ \t]+$/g, '')
    if (t) out.push(asciiLower(t))
  }
  return out
}

/** Допущен ли рабочий с такими навыками к типу РЦ (правило движка). */
export function engineEligible(skills: readonly string[], typeName: string, typeId: string): boolean {
  if (skills.length === 0) return true
  const nm = asciiLower(typeName)
  const idl = asciiLower(typeId)
  return skills.some((t) => t === nm || t === idl || (encoder.encode(t).length > 3 && nm.includes(t)))
}

export function buildResources(model: ProcessModel, data: ProcessData): Map<string, ResourceRow> {
  const workers = data.workers.map((w) => ({ id: w.id, skills: parseSkills(w.skills) }))
  const total = workers.length
  const opCount = new Map<string, number>()
  for (const op of model.ops.values()) for (const t of op.wcTypeIds) opCount.set(t, (opCount.get(t) ?? 0) + 1)

  const out = new Map<string, ResourceRow>()
  for (const t of model.wcTypes.values()) {
    const eligible = workers.filter((w) => engineEligible(w.skills, t.name, t.id)).map((w) => w.id)
    const machines = t.machineIds.length
    const fallbackAll = total > 0 && eligible.length === 0
    const effectiveOperators = total === 0 ? 0 : fallbackAll ? total : eligible.length
    const capacity = total === 0 ? machines : Math.min(machines, effectiveOperators)
    out.set(t.id, {
      wcTypeId: t.id,
      name: t.name,
      group: t.group,
      colorIndex: t.colorIndex,
      machines,
      eligibleWorkerIds: eligible,
      effectiveOperators,
      fallbackAll,
      capacity,
      laborConstrained: total > 0 && machines > 0 && effectiveOperators < machines,
      opCount: opCount.get(t.id) ?? 0,
    })
  }
  return out
}

export interface ResourceTotals {
  machines: number
  capacity: number
  laborConstrainedTypes: number
  typesWithoutMachines: number
  workers: number
}

export function resourceTotals(rows: Iterable<ResourceRow>, workers: number): ResourceTotals {
  let machines = 0, capacity = 0, laborConstrainedTypes = 0, typesWithoutMachines = 0
  for (const r of rows) {
    machines += r.machines
    capacity += r.capacity
    if (r.laborConstrained) laborConstrainedTypes += 1
    if (r.machines === 0 && r.opCount > 0) typesWithoutMachines += 1
  }
  return { machines, capacity, laborConstrainedTypes, typesWithoutMachines, workers }
}
