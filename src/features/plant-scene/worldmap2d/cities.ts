/**
 * Гео-координаты опорных узлов мировой 2D-карты.
 *
 * КООРДИНАТНАЯ МОДЕЛЬ (важно): у мировой карты СВОЁ пространство — географические
 * [lng, lat]. Оно НЕ пересекается с pos_x/pos_z (абстрактные 3D-координаты площадки/
 * цеха), которые остаются нетронутыми для 3D-видов. Приоритет источника координат узла:
 *   1) node.lat / node.lng (из org_units.lat/lng — появятся после миграции БД);
 *   2) CITY_COORDS[orgUnitId] — реальные города РФ для демо-холдинга (фолбэк до миграции);
 *   3) affineFromGrid(pos_x, pos_z) — раскладка абстрактных координат в bbox региона
 *      (для прочих проектов без гео-данных).
 */

/** Гео-охват базовой подложки (см. geodata/ural.geo.json). Держим синхронно с bbox. */
export const URAL_BBOX = { minLng: 50.77, maxLng: 68.71, minLat: 50.5, maxLat: 61.95 }

/** Реальные индустриальные города Урала для 4 узлов демо-холдинга (по id org_unit). */
export const CITY_COORDS: Record<string, { lat: number; lng: number; city: string }> = {
  'holding-factory-1': { lat: 53.41, lng: 59.0, city: 'Магнитогорск' },   // Металлургический (ММК)
  'holding-factory-2': { lat: 55.16, lng: 61.4, city: 'Челябинск' },      // Трубопрокатный (ЧТПЗ)
  'holding-factory-3': { lat: 56.84, lng: 60.65, city: 'Екатеринбург' },  // Механосборочный (Уралмаш)
  'holding-warehouse': { lat: 54.74, lng: 55.97, city: 'Уфа' },           // Центральный склад
}

/**
 * Фолбэк-раскладка абстрактных координат (pos_x/pos_z, обычно ±60) в гео-bbox региона —
 * чтобы карты прочих проектов (без реальных городов) всё равно отрисовывались осмысленно.
 * Детерминировано, без сети. Сжимаем к центральной части bbox, чтобы узлы не липли к краям.
 */
export function affineFromGrid(px: number, pz: number): { lat: number; lng: number } {
  const SPAN = 60 // характерный масштаб мировой сетки (FSP=60 в sceneModel)
  const clamp = (v: number) => Math.max(-1, Math.min(1, v / SPAN))
  const u = (clamp(px) + 1) / 2 // 0..1
  const v = (clamp(pz) + 1) / 2 // 0..1
  const midLng = (URAL_BBOX.minLng + URAL_BBOX.maxLng) / 2
  const midLat = (URAL_BBOX.minLat + URAL_BBOX.maxLat) / 2
  const halfLng = (URAL_BBOX.maxLng - URAL_BBOX.minLng) * 0.32
  const halfLat = (URAL_BBOX.maxLat - URAL_BBOX.minLat) * 0.32
  return {
    lng: midLng + (u - 0.5) * 2 * halfLng,
    lat: midLat - (v - 0.5) * 2 * halfLat, // z↓ = юг (lat↓): экран-z растёт вниз
  }
}

/** Единая точка получения [lng, lat] узла-завода/склада с учётом приоритета источников. */
export function nodeLngLat(node: {
  lat?: number
  lng?: number
  orgUnitId?: string
  position: [number, number]
}): [number, number] {
  if (typeof node.lat === 'number' && typeof node.lng === 'number' && !Number.isNaN(node.lat) && !Number.isNaN(node.lng)) {
    return [node.lng, node.lat]
  }
  if (node.orgUnitId && CITY_COORDS[node.orgUnitId]) {
    const c = CITY_COORDS[node.orgUnitId]
    return [c.lng, c.lat]
  }
  const g = affineFromGrid(node.position[0], node.position[1])
  return [g.lng, g.lat]
}
