/**
 * Единая геометрия зон площадки — общий источник координат, чтобы RailYard, Facility
 * и Decorations стыковались согласованно, без нагромождений.
 *
 *  • railSpur   — ось и конец жд-спура (ответвление путей на территорию). Спур уводим
 *                 в ЗАПАДНУЮ часть (дальше от главных ворот/фасада на +X) и держим у
 *                 СЕВЕРНОЙ («задней») кромки — не лезет в центр/фасад.
 *  • parkingSpot — парковка грузовиков ОТДЕЛЬНО, в угол у главных ворот (+X, север),
 *                 разнесена с жд-погрузкой (устраняем «нагромождение»). К ней ведёт дорога.
 * Всё из габаритов площадки — одинаково во всех компонентах.
 */
export function railSpur(minX: number, maxX: number, minZ: number, maxZ: number) {
  const W = maxX - minX
  const x = minX + W * 0.28                                // ось спура — западнее (дальше от фасада)
  const endZ = minZ + Math.min(9, (maxZ - minZ) * 0.22)    // заходит недалеко, у «задней» кромки
  return { x, endZ, entryZ: minZ, gateHalf: 2.6 }
}

/**
 * Парковка — в угол у главных ворот (+X). Из двух углов (СВ/ЮВ) выбираем тот, что
 * ДАЛЬШЕ от всех цехов, чтобы стоянка НЕ налезала на угловой цех. Одинаково считается
 * в Facility (дорога к парковке) и Decorations (сама парковка) — при одинаковых nodes.
 */
export function parkingSpot(
  _minX: number, maxX: number, minZ: number, maxZ: number,
  nodes: readonly { position: [number, number] }[] = [],
) {
  const cands: [number, number][] = [[maxX - 9, minZ + 10], [maxX - 9, maxZ - 10]]
  let best = cands[0], bestD = -1
  for (const c of cands) {
    let d = Infinity
    for (const n of nodes) {
      const dx = c[0] - n.position[0], dz = c[1] - n.position[1]
      d = Math.min(d, dx * dx + dz * dz)
    }
    if (d > bestD) { bestD = d; best = c }
  }
  return { x: best[0], z: best[1] }
}
