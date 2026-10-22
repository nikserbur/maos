/**
 * Базовая подложка мировой карты по теме (X1 §1 п. 1): тёмная тема — CARTO «dark-matter»,
 * светлая — CARTO «positron». Оба векторных стиля без API-ключа. Подписи — русские
 * (`name:ru` с фолбэком) цветом `--text-muted` на ореоле `--bg-app`; слои дорог OSRM
 * добавляются под первым слоем подписей и переживают смену стиля (`style.load`).
 */
import type maplibregl from 'maplibre-gl'
import type { Theme } from '../../../shell/theme'
import type { ThemeColors } from '../themeColors'

export const BASEMAP_STYLE: Readonly<Record<Theme, string>> = {
  dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  light: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
}

export const ROUTES_SOURCE = 'routes'
export const ROUTES_CASING = 'routes-casing'
export const ROUTES_LINE = 'routes-line'

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }

/** Подписи базового стиля: русские имена, цвет `--text-muted`, ореол цвета фона приложения. */
export function styleLabels(map: maplibregl.Map, c: ThemeColors): void {
  for (const l of map.getStyle().layers ?? []) {
    if (l.type !== 'symbol') continue
    try {
      if (map.getLayoutProperty(l.id, 'text-field') == null) continue
      map.setLayoutProperty(l.id, 'text-field',
        ['coalesce', ['get', 'name:ru'], ['get', 'name_ru'], ['get', 'name'], ['get', 'name_en'], ['get', 'name:latin']])
      map.setPaintProperty(l.id, 'text-color', c.textMuted)
      map.setPaintProperty(l.id, 'text-halo-color', c.bgApp)
      map.setPaintProperty(l.id, 'text-halo-width', 1)
    } catch { /* слой без текста или без paint-свойств подписи */ }
  }
}

/** Дороги: ультрамарин бренда в тёмной обводке (`--ink`) — читается и на суше, и на воде. */
export function applyRouteColors(map: maplibregl.Map, c: ThemeColors): void {
  try {
    if (map.getLayer(ROUTES_CASING)) map.setPaintProperty(ROUTES_CASING, 'line-color', c.ink)
    if (map.getLayer(ROUTES_LINE)) map.setPaintProperty(ROUTES_LINE, 'line-color', c.ultramarine)
  } catch { /* стиль перезагружается — цвета применятся после style.load */ }
}

/** Источник и слои дорог (под первым слоем подписей); данные — последние известные трассы. */
export function ensureRouteLayers(map: maplibregl.Map, c: ThemeColors, data: GeoJSON.FeatureCollection = EMPTY): void {
  if (map.getSource(ROUTES_SOURCE)) return
  const firstSymbol = map.getStyle().layers?.find((l) => l.type === 'symbol')?.id
  map.addSource(ROUTES_SOURCE, { type: 'geojson', data })
  map.addLayer({ id: ROUTES_CASING, type: 'line', source: ROUTES_SOURCE,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': c.ink, 'line-width': 7, 'line-opacity': 0.85 } }, firstSymbol)
  map.addLayer({ id: ROUTES_LINE, type: 'line', source: ROUTES_SOURCE,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': c.ultramarine, 'line-width': 3.5, 'line-opacity': 0.95 } }, firstSymbol)
}

/** Обновить геометрию дорог (если источник ещё не создан — ничего не делаем). */
export function setRouteData(map: maplibregl.Map, data: GeoJSON.FeatureCollection): void {
  const src = map.getSource(ROUTES_SOURCE) as maplibregl.GeoJSONSource | undefined
  src?.setData(data)
}

/** Прямой отрезок между двумя точками — мгновенный фолбэк до ответа OSRM. */
export function straightLine(a: [number, number], b: [number, number]): GeoJSON.Feature {
  return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [a, b] } }
}

/**
 * Реальная трасса между точками через OSRM (маршрутизатор OpenStreetMap). Концы «пришиваются»
 * к координатам городов: OSRM привязывает старт/финиш к ближайшей дороге, и линия могла
 * не доходить до пина. Офлайн/лимит → null (остаётся прямая).
 */
export async function fetchRoadRoute(
  a: [number, number], b: [number, number], signal: AbortSignal,
): Promise<GeoJSON.Feature | null> {
  const url = `https://router.project-osrm.org/route/v1/driving/${a[0]},${a[1]};${b[0]},${b[1]}?overview=full&geometries=geojson`
  try {
    const r = await fetch(url, { signal })
    if (!r.ok) return null
    const j: unknown = await r.json()
    const coords = (j as { routes?: Array<{ geometry?: { coordinates?: unknown } }> })?.routes?.[0]?.geometry?.coordinates
    if (!Array.isArray(coords) || coords.length < 2) return null
    return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [a, ...(coords as [number, number][]), b] } }
  } catch {
    return null
  }
}
