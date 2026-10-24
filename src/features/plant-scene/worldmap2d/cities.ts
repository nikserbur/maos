/**
 * Гео-координаты опорных узлов мировой 2D-карты.
 *
 * КООРДИНАТНАЯ МОДЕЛЬ (важно): у мировой карты СВОЁ пространство — географические
 * [lng, lat]. Оно НЕ пересекается с pos_x/pos_z (абстрактные 3D-координаты площадки/
 * цеха), которые остаются нетронутыми для 3D-видов. Источники координат узла:
 *   1) node.lat / node.lng (из org_units.lat/lng);
 *   2) CITY_COORDS[orgUnitId] — реальные города РФ для демо-холдинга (до миграции БД).
 * Выдуманных точек нет (X2 P-35): узел без настоящих координат на карту не ставится —
 * инспектор говорит «Расположение не задано».
 */

/** Реальные индустриальные города Урала для 4 узлов демо-холдинга (по id org_unit). */
export const CITY_COORDS: Record<string, { lat: number; lng: number; city: string }> = {
  'holding-factory-1': { lat: 53.41, lng: 59.0, city: 'Магнитогорск' },   // Металлургический (ММК)
  'holding-factory-2': { lat: 55.16, lng: 61.4, city: 'Челябинск' },      // Трубопрокатный (ЧТПЗ)
  'holding-factory-3': { lat: 56.84, lng: 60.65, city: 'Екатеринбург' },  // Механосборочный (Уралмаш)
  'holding-warehouse': { lat: 54.74, lng: 55.97, city: 'Уфа' },           // Центральный склад
}

interface GeoNode {
  lat?: number
  lng?: number
  orgUnitId?: string
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** [lng, lat] узла-завода/склада по настоящим координатам; нет координат — null (пин не ставится). */
export function nodeLngLat(node: GeoNode): [number, number] | null {
  if (finite(node.lat) && finite(node.lng)) return [node.lng, node.lat]
  const c = node.orgUnitId ? CITY_COORDS[node.orgUnitId] : undefined
  return c ? [c.lng, c.lat] : null
}

/** Есть ли у площадки настоящие координаты. */
export const hasRealGeo = (node: GeoNode): boolean => nodeLngLat(node) !== null

/** Мировую карту показываем, только если настоящие координаты есть хотя бы у двух площадок. */
export const MIN_GEO_SITES = 2
