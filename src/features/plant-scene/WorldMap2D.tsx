/**
 * Мировая карта — НАСТОЯЩАЯ тёмная карта (MapLibre GL + тёмный векторный стиль CARTO
 * dark-matter, без API-ключа). Реальная география/подписи/дороги, как Mapbox/Google.
 * Рендерится как обычный DOM-компонент (НЕ внутри R3F Canvas) только на уровне `world`.
 *
 * Заводы/склад — пины «цвет статуса + глиф (● ▲ ○ ■)» в РЕАЛЬНЫХ городах Урала (см. cities.ts);
 * выбранный — акцент с ореолом. Цвета дорог берутся из токенов темы (themeColors.ts).
 * «Дороги» между складом и заводами строятся по НАСТОЯЩИМ трассам через OSRM
 * (маршрутизатор OpenStreetMap); при недоступности сети — прямая линия (fallback).
 * Наведение на пин — карточка KPI (статус / цехов / станков).
 *
 * Требует интернет (тайлы CARTO + маршруты OSRM). Drop-in: те же 7 пропсов + onBackground.
 */
import { useEffect, useMemo, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { SceneNode, SceneEdge, SceneGraph } from './graph/sceneModel'
import { STATUS_META } from './types'
import { useThemeColors, type ThemeColors } from './themeColors'
import { nodeLngLat } from './worldmap2d/cities'
import './worldmap2d/worldmap2d.css'

// Чистая ВЕКТОРНАЯ карта в стиле Яндекс/Google: база OpenFreeMap «liberty» (без API-ключа),
// перекрашенная в ровную палитру — зелёная суша, navy-океаны, синие реки, мягкие границы,
// РУССКИЕ подписи. Растровый рельеф (гипсометрия/hillshade) УБРАН намеренно: именно он на
// отдалении давал блочные/«низкополигональные» пятна и грязь. Без него карта гладкая.
const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty'

/** Дороги: ультрамарин бренда в тёмной обводке (--ink) — читается на суше и воде. */
function applyRouteColors(map: maplibregl.Map, c: ThemeColors): void {
  try {
    if (map.getLayer('routes-casing')) map.setPaintProperty('routes-casing', 'line-color', c.ink)
    if (map.getLayer('routes-line')) map.setPaintProperty('routes-line', 'line-color', c.ultramarine)
  } catch { /* стиль перезагружается — цвета применятся в следующем load */ }
}

/** Палитра базовой карты (декоративная, AUDIT §5 — как материалы 3D): суша по типу покрова, вода, границы. */
const MAP = {
  land: '#5f8466', wood: '#4c7a5a', grass: '#7c9a6c', sand: '#cbb787', ice: '#dde7ed',
  water: '#2f4d74', river: '#3f6aa4', boundary: '#7d7288',
} as const

/**
 * Перекраска базового стиля в чистую «яндекс-подобную» палитру + русские подписи.
 * Красим ПО ЭВРИСТИКЕ имён слоёв (устойчиво к точному набору id в конкретном стиле):
 * fill воды→navy, лес→зелёный, степь/парк→светло-зелёный, песок→бежевый, лёд→светлый;
 * line рек→синий, границ→приглушённый; symbol с текстом→name:ru с фолбэком.
 */
function styleBasemap(map: maplibregl.Map): void {
  const setPaint = (id: string, prop: string, val: unknown) => {
    try { if (map.getLayer(id)) map.setPaintProperty(id, prop as never, val as never) } catch { /* нет слоя/свойства */ }
  }
  try { map.setPaintProperty('background', 'background-color', MAP.land) } catch { /* нет фона */ }
  for (const l of map.getStyle().layers || []) {
    const id = l.id
    if (l.type === 'fill') {
      if (/water|ocean|sea|bay|lake|reservoir/i.test(id)) setPaint(id, 'fill-color', MAP.water)
      else if (/glacier|ice|snow/i.test(id)) setPaint(id, 'fill-color', MAP.ice)
      else if (/sand|desert|beach|bare|scree/i.test(id)) setPaint(id, 'fill-color', MAP.sand)
      else if (/wood|forest/i.test(id)) setPaint(id, 'fill-color', MAP.wood)
      else if (/grass|meadow|scrub|heath|park|garden|wetland|farmland|landcover/i.test(id)) setPaint(id, 'fill-color', MAP.grass)
    } else if (l.type === 'line') {
      if (/water|river|stream|canal|waterway/i.test(id)) setPaint(id, 'line-color', MAP.river)
      else if (/boundary|admin|border/i.test(id)) { setPaint(id, 'line-color', MAP.boundary); setPaint(id, 'line-opacity', 0.55) }
    } else if (l.type === 'symbol') {
      try {
        if (map.getLayoutProperty(id, 'text-field') != null)
          map.setLayoutProperty(id, 'text-field',
            ['coalesce', ['get', 'name:ru'], ['get', 'name'], ['get', 'name:en'], ['get', 'name:latin']])
      } catch { /* слой без текста */ }
    }
  }
}

const ICON_FACTORY =
  '<svg viewBox="0 0 24 24"><path d="M3 21V10l6 3V10l6 3V4h4v17H3zm4-3h2v-2H7v2zm4 0h2v-2h-2v2z"/></svg>'
const ICON_WAREHOUSE =
  '<svg viewBox="0 0 24 24"><path d="M12 3 2 8v13h20V8L12 3zm-3 15v-6h6v6H9z"/></svg>'

export interface WorldMap2DProps {
  nodes: SceneNode[]
  edges: SceneEdge[]
  selectedId: string | null
  editing: boolean
  onSelect: (id: string) => void
  onEnter: (id: string) => void
  onMove: (id: string, position: [number, number]) => void
  onBackground?: () => void
  graph?: SceneGraph
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))

export function WorldMap2D({ nodes, edges, selectedId, onSelect, onEnter, onBackground, graph }: WorldMap2DProps) {
  const boxRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const readyRef = useRef(false)
  const markersRef = useRef<Map<string, { marker: maplibregl.Marker; el: HTMLDivElement; popup: maplibregl.Popup; node: SceneNode }>>(new Map())
  const fittedRef = useRef(false)

  // Актуальные колбэки без пересоздания карты.
  const cbRef = useRef({ onSelect, onEnter, onBackground })
  cbRef.current = { onSelect, onEnter, onBackground }
  const colors = useThemeColors()
  const colorsRef = useRef(colors)
  colorsRef.current = colors

  // Кол-во цехов/станков на завод — для карточки KPI.
  const stats = useMemo(() => {
    const m = new Map<string, { shops: number; machines: number }>()
    if (!graph) return m
    const shopFactory = new Map<string, string>()
    for (const n of graph.nodes) if (n.refType === 'shop') shopFactory.set(n.id, n.parentId || '')
    for (const n of graph.nodes) {
      if (n.refType === 'shop') {
        const f = n.parentId || ''
        const s = m.get(f) || { shops: 0, machines: 0 }
        s.shops++; m.set(f, s)
      }
    }
    for (const n of graph.nodes) {
      if (n.refType === 'machine') {
        const f = shopFactory.get(n.parentId || '')
        if (f) { const s = m.get(f) || { shops: 0, machines: 0 }; s.machines++; m.set(f, s) }
      }
    }
    return m
  }, [graph])

  const placed = useMemo(
    () => nodes.filter((n) => n.refType === 'factory').map((n) => ({ node: n, lngLat: nodeLngLat(n) })),
    [nodes],
  )

  const cardHtml = (node: SceneNode) => {
    const meta = STATUS_META[node.status]
    const s = stats.get(node.id)
    const warehouse = node.kind === 'wirehouse'
    const row = (k: string, v: string) => `<div class="wm2d-card__row"><span>${k}</span><b class="num">${v}</b></div>`
    return (
      `<div class="wm2d-card__head"><span class="wm2d-card__kind">${warehouse ? 'Склад' : 'Завод'}</span>` +
      `<div class="wm2d-card__title">${esc(node.title)}</div></div>` +
      `<div class="wm2d-card__row"><span>Статус</span>` +
      `<b class="wm2d-card__status ${meta.glyphClass}" style="color:${meta.cssVar}">${esc(meta.label)}</b></div>` +
      (warehouse
        ? row('Тип', 'Центральный склад')
        : row('Цехов', String(s?.shops ?? 0)) + row('Станков', String(s?.machines ?? 0))) +
      `<div class="wm2d-card__foot">2×ЛКМ — войти на площадку</div>`
    )
  }

  // ── Создание карты (один раз) ──
  useEffect(() => {
    if (!boxRef.current) return
    const map = new maplibregl.Map({
      container: boxRef.current,
      style: STYLE_URL,
      center: [59.5, 55],
      zoom: 5,
      attributionControl: { compact: true },
    })
    mapRef.current = map
    if (import.meta.env.DEV) (window as unknown as { __wmMap: maplibregl.Map }).__wmMap = map
    // Правый нижний угол свободен от оверлеев схемы (сверху — кнопка симуляции).
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')
    map.on('click', () => cbRef.current.onBackground?.())
    map.on('load', () => {
      readyRef.current = true
      styleBasemap(map)   // чистая палитра + русские подписи (без растрового рельефа)
      // Слои дорог (реальные трассы OSRM) — вставляем ПОД первым слоем подписей.
      const firstSymbol = map.getStyle().layers?.find((l) => l.type === 'symbol')?.id
      map.addSource('routes', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({ id: 'routes-casing', type: 'line', source: 'routes',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': colorsRef.current.ink, 'line-width': 7, 'line-opacity': 0.85 } }, firstSymbol)
      map.addLayer({ id: 'routes-line', type: 'line', source: 'routes',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': colorsRef.current.ultramarine, 'line-width': 3.5, 'line-opacity': 0.95 } }, firstSymbol)
      map.fire('wm2d:ready')
    })
    return () => { readyRef.current = false; markersRef.current.clear(); map.remove(); mapRef.current = null }
  }, [])

  // ── Смена темы → цвета дорог (без пересоздания карты) ──
  useEffect(() => {
    const map = mapRef.current
    if (map && readyRef.current) applyRouteColors(map, colors)
  }, [colors])

  // ── Маркеры-пины ──
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const build = () => {
      const store = markersRef.current
      for (const { marker } of store.values()) marker.remove()
      store.clear()
      for (const { node, lngLat } of placed) {
        const warehouse = node.kind === 'wirehouse'
        const meta = STATUS_META[node.status]
        const el = document.createElement('div')
        el.className = `wm2d-pin wm2d-pin--${node.status}` + (node.id === selectedId ? ' is-selected' : '')
        el.setAttribute('role', 'button')
        el.setAttribute('aria-label', `${node.title} — ${meta.label}`)
        el.innerHTML =
          `<div class="wm2d-pin__body"><div class="wm2d-pin__badge">${warehouse ? ICON_WAREHOUSE : ICON_FACTORY}` +
          `<span class="wm2d-pin__glyph ${meta.glyphClass}"></span></div><div class="wm2d-pin__tip"></div></div>`
        const popup = new maplibregl.Popup({ offset: 22, closeButton: false, className: 'wm2d-popup' }).setHTML(cardHtml(node))
        const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat(lngLat as [number, number]).addTo(map)
        el.addEventListener('mouseenter', () => { popup.setLngLat(lngLat as [number, number]).setHTML(cardHtml(node)).addTo(map) })
        el.addEventListener('mouseleave', () => { if (node.id !== selectedId) popup.remove() })
        el.addEventListener('click', (e) => { e.stopPropagation(); cbRef.current.onSelect(node.id) })
        el.addEventListener('dblclick', (e) => { e.stopPropagation(); cbRef.current.onEnter(node.id) })
        store.set(node.id, { marker, el, popup, node })
      }
      // Первое авто-кадрирование по узлам.
      if (!fittedRef.current && placed.length) {
        const b = new maplibregl.LngLatBounds()
        for (const { lngLat } of placed) b.extend(lngLat as [number, number])
        map.fitBounds(b, { padding: 90, maxZoom: 8, duration: 0 })
        fittedRef.current = true
      }
    }
    if (readyRef.current) build()
    else map.once('wm2d:ready', build)
  }, [placed, selectedId, stats])

  // ── Дороги: прямые линии сразу + реальные трассы OSRM асинхронно ──
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const ac = new AbortController()
    const posById = new Map(placed.map((p) => [p.node.id, p.lngLat as [number, number]]))
    const segs = edges
      .map((e) => ({ id: e.id, a: posById.get(e.from), b: posById.get(e.to) }))
      .filter((s): s is { id: string; a: [number, number]; b: [number, number] } => !!s.a && !!s.b)

    const apply = (feats: GeoJSON.Feature[]) => {
      const src = map.getSource('routes') as maplibregl.GeoJSONSource | undefined
      src?.setData({ type: 'FeatureCollection', features: feats })
    }
    const straight = (s: { a: [number, number]; b: [number, number] }): GeoJSON.Feature => ({
      type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [s.a, s.b] },
    })

    const run = () => {
      const feats: GeoJSON.Feature[] = segs.map(straight)
      apply(feats)
      // Апгрейд до реальных дорог (OSRM), по одному сегменту.
      segs.forEach((s, i) => {
        const url = `https://router.project-osrm.org/route/v1/driving/${s.a[0]},${s.a[1]};${s.b[0]},${s.b[1]}?overview=full&geometries=geojson`
        fetch(url, { signal: ac.signal })
          .then((r) => (r.ok ? r.json() : null))
          .then((j) => {
            const coords = j?.routes?.[0]?.geometry?.coordinates
            if (Array.isArray(coords) && coords.length > 1) {
              // Пришиваем точные координаты городов к концам маршрута: OSRM привязывает
              // старт/финиш к ближайшей дороге, из-за чего линия могла не доходить до пина.
              feats[i] = { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [s.a, ...coords, s.b] } }
              apply([...feats])
            }
          })
          .catch(() => {}) // офлайн/лимит — остаётся прямая линия
      })
    }
    if (readyRef.current) run()
    else map.once('wm2d:ready', run)
    return () => ac.abort()
  }, [edges, placed])

  return <div className="wm2d"><div className="wm2d__map" ref={boxRef} /></div>
}
