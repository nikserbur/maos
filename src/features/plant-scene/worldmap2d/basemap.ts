/**
 * Базовая подложка мировой карты — предустановленная, без внешних серверов: векторные тайлы
 * OpenStreetMap региона площадок (сборка Protomaps), стиль Protomaps тёмный/светлый по теме, шрифты
 * Noto Sans, значки и дорожные маршруты лежат в public/maps (готовит scripts/maps/build-offline-maps.mjs).
 * Тайлы хранятся сжатыми и читаются своим протоколом `maos-tiles://` (распаковка в браузере).
 * Подписи — русские (`name:ru` с фолбэком) цветом `--text-muted` на ореоле `--bg-app`; дороги —
 * нейтральные (--chart-8, 2,5 px, обводка --ink), акцент — только у выбранного пина; слои дорог
 * добавляются под первым слоем подписей и переживают смену стиля (`style.load`).
 */
import type { LayerSpecification, StyleSpecification } from 'maplibre-gl'
import type maplibregl from 'maplibre-gl'
import type { Theme } from '../../../shell/theme'
import type { ThemeColors } from '../themeColors'
import darkStyle from './styles/dark.json'
import lightStyle from './styles/light.json'

/** Каталог предустановленных карт в поставке приложения. */
const MAPS_DIR = `${import.meta.env.BASE_URL}maps`.replace(/\/{2,}/g, '/')
/** Абсолютный адрес файла карт (шаблоны {fontstack}/{range} не кодируются). */
const mapsUrl = (rel: string): string => `${window.location.origin}${MAPS_DIR}/${rel}`

/** Протокол предустановленных тайлов: maos-tiles://{z}/{x}/{y}. */
export const TILE_PROTOCOL = 'maos-tiles'
const ATTRIBUTION = '© участники OpenStreetMap · Protomaps'
/** Область предустановленных тайлов (обзорные масштабы); дальше карту не уводим. */
export const MAP_BOUNDS: [[number, number], [number, number]] = [[40, 48], [80, 66]]
export const MAP_MIN_ZOOM = 3

const LAYERS: Readonly<Record<Theme, LayerSpecification[]>> = {
  dark: (darkStyle as { layers: LayerSpecification[] }).layers,
  light: (lightStyle as { layers: LayerSpecification[] }).layers,
}

/** Стиль подложки по теме: всё — из поставки приложения. */
export function basemapStyle(theme: Theme): StyleSpecification {
  return {
    version: 8,
    glyphs: mapsUrl('fonts/{fontstack}/{range}.pbf'),
    sprite: mapsUrl(`sprites/${theme}`),
    sources: {
      protomaps: { type: 'vector', tiles: [`${TILE_PROTOCOL}://{z}/{x}/{y}`], minzoom: 0, maxzoom: 8, attribution: ATTRIBUTION },
    },
    layers: LAYERS[theme],
  }
}

const isGzip = (b: Uint8Array): boolean => b.length > 2 && b[0] === 0x1f && b[1] === 0x8b

/** Загрузка предустановленного тайла: файл .mvt.gz, распаковка в браузере; вне региона — пустой тайл. */
export async function loadOfflineTile(params: { url: string }, abort: AbortController): Promise<{ data: ArrayBuffer }> {
  const m = /^maos-tiles:\/\/(\d+)\/(\d+)\/(\d+)/.exec(params.url)
  if (!m) throw new Error(`Неверный адрес тайла: ${params.url}`)
  const r = await fetch(mapsUrl(`tiles/${m[1]}/${m[2]}/${m[3]}.mvt.gz`), { signal: abort.signal })
  if (!r.ok || (r.headers.get('content-type') ?? '').includes('text/html')) return { data: new ArrayBuffer(0) }
  const raw = new Uint8Array(await r.arrayBuffer())
  if (!isGzip(raw)) return { data: raw.buffer }
  const data = await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
  return { data }
}

let registered = false
/** Регистрирует протокол тайлов один раз на всё приложение. */
export function registerOfflineTiles(lib: typeof maplibregl): void {
  if (registered) return
  lib.addProtocol(TILE_PROTOCOL, loadOfflineTile)
  registered = true
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

/** Цвет линии дорог: нейтральный «прочее» (--chart-8), не акцент — акцент только у выбора (X2 P-40). */
const routeColor = (c: ThemeColors): string => c.chart[7] ?? c.textMuted

/** Дороги: нейтральная линия 2,5 px в тёмной обводке (`--ink`) — читается и на суше, и на воде. */
export function applyRouteColors(map: maplibregl.Map, c: ThemeColors): void {
  try {
    if (map.getLayer(ROUTES_CASING)) map.setPaintProperty(ROUTES_CASING, 'line-color', c.ink)
    if (map.getLayer(ROUTES_LINE)) map.setPaintProperty(ROUTES_LINE, 'line-color', routeColor(c))
  } catch { /* стиль перезагружается — цвета применятся после style.load */ }
}

/** Источник и слои дорог (под первым слоем подписей); данные — последние известные трассы. */
export function ensureRouteLayers(map: maplibregl.Map, c: ThemeColors, data: GeoJSON.FeatureCollection = EMPTY): void {
  if (map.getSource(ROUTES_SOURCE)) return
  const firstSymbol = map.getStyle().layers?.find((l) => l.type === 'symbol')?.id
  map.addSource(ROUTES_SOURCE, { type: 'geojson', data })
  map.addLayer({ id: ROUTES_CASING, type: 'line', source: ROUTES_SOURCE,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': c.ink, 'line-width': 5, 'line-opacity': 0.85 } }, firstSymbol)
  map.addLayer({ id: ROUTES_LINE, type: 'line', source: ROUTES_SOURCE,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': routeColor(c), 'line-width': 2.5, 'line-opacity': 0.95 } }, firstSymbol)
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

interface StoredRoute { a: [number, number]; b: [number, number]; line: [number, number][] }
let routesPromise: Promise<StoredRoute[]> | null = null

/** Маршруты между площадками из поставки (рассчитаны заранее по дорогам OpenStreetMap). */
function storedRoutes(): Promise<StoredRoute[]> {
  routesPromise ??= fetch(mapsUrl('routes.json'))
    .then((r) => (r.ok ? r.json() : { routes: [] }))
    .then((j: { routes?: StoredRoute[] }) => (Array.isArray(j.routes) ? j.routes : []))
    .catch(() => [])
  return routesPromise
}

const near = (p: [number, number], q: [number, number]): boolean => Math.abs(p[0] - q[0]) < 0.05 && Math.abs(p[1] - q[1]) < 0.05

/**
 * Дорожная трасса между точками из предустановленных маршрутов; концы «пришиваются» к координатам
 * пинов. Пары без готового маршрута (площадка с новыми координатами) → null (остаётся прямая).
 */
export async function fetchRoadRoute(
  a: [number, number], b: [number, number], signal: AbortSignal,
): Promise<GeoJSON.Feature | null> {
  const all = await storedRoutes()
  if (signal.aborted) return null
  const fwd = all.find((r) => near(r.a, a) && near(r.b, b))
  const rev = fwd ? undefined : all.find((r) => near(r.a, b) && near(r.b, a))
  const line = fwd ? fwd.line : rev ? [...rev.line].reverse() : null
  if (!line || line.length < 2) return null
  return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [a, ...line, b] } }
}
