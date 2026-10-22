/**
 * Мировая карта — настоящая векторная карта (MapLibre GL), подложка ПО ТЕМЕ (X1 §1 п. 1):
 * тёмная — CARTO «dark-matter», светлая — CARTO «positron», без API-ключа. При смене
 * `<html data-theme>` стиль переключается на лету, слои дорог восстанавливаются после
 * `style.load`. Рендерится как обычный DOM-компонент (НЕ внутри R3F Canvas) на уровне `world`.
 *
 * Заводы/склад — пины «цвет статуса + глиф (● ▲ ○ ■)» в реальных городах (см. cities.ts);
 * выбранный — акцент с ореолом. Дороги склад↔заводы — настоящие трассы через OSRM, при
 * недоступности сети — прямая линия. Наведение на пин — карточка KPI (`MapCard`, React-портал
 * в popup MapLibre — X1 §1 п. 7).
 *
 * Требует интернет (тайлы CARTO + маршруты OSRM). Drop-in: те же 7 пропсов + onBackground.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { SceneNode, SceneEdge, SceneGraph } from './graph/sceneModel'
import { STATUS_META } from './types'
import { useThemeColors, type ThemeColors } from './themeColors'
import { nodeLngLat } from './worldmap2d/cities'
import { MapCard, type MapCardStats } from './worldmap2d/MapCard'
import {
  BASEMAP_STYLE, applyRouteColors, ensureRouteLayers, fetchRoadRoute, setRouteData, straightLine, styleLabels,
} from './worldmap2d/basemap'
import './worldmap2d/worldmap2d.css'

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

type LngLat = [number, number]

/** Кол-во цехов/станков на завод — для карточки KPI. */
function factoryStats(graph: SceneGraph | undefined): Map<string, MapCardStats> {
  const m = new Map<string, MapCardStats>()
  if (!graph) return m
  const shopFactory = new Map<string, string>()
  const bump = (f: string, key: keyof MapCardStats) => {
    const s = m.get(f) ?? { shops: 0, machines: 0 }
    m.set(f, { ...s, [key]: s[key] + 1 })
  }
  for (const n of graph.nodes) if (n.refType === 'shop') { shopFactory.set(n.id, n.parentId || ''); bump(n.parentId || '', 'shops') }
  for (const n of graph.nodes) {
    if (n.refType !== 'machine') continue
    const f = shopFactory.get(n.parentId || '')
    if (f) bump(f, 'machines')
  }
  return m
}

export function WorldMap2D({ nodes, edges, selectedId, onSelect, onEnter, onBackground, graph }: WorldMap2DProps) {
  const boxRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const readyRef = useRef(false)
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map())
  const popupRef = useRef<maplibregl.Popup | null>(null)
  const cardElRef = useRef<HTMLDivElement | null>(null)
  const routeDataRef = useRef<GeoJSON.FeatureCollection>({ type: 'FeatureCollection', features: [] })
  const fittedRef = useRef(false)
  /** Тема, под которую загружен текущий стиль подложки. */
  const styleThemeRef = useRef<ThemeColors['theme'] | null>(null)
  const [hoverId, setHoverId] = useState<string | null>(null)

  // Актуальные колбэки/цвета без пересоздания карты.
  const cbRef = useRef({ onSelect, onEnter, onBackground })
  cbRef.current = { onSelect, onEnter, onBackground }
  const colors = useThemeColors()
  const colorsRef = useRef(colors)
  colorsRef.current = colors

  const stats = useMemo(() => factoryStats(graph), [graph])
  const placed = useMemo(
    () => nodes.filter((n) => n.refType === 'factory').map((n) => ({ node: n, lngLat: nodeLngLat(n) as LngLat })),
    [nodes],
  )
  if (!cardElRef.current && typeof document !== 'undefined') {
    cardElRef.current = document.createElement('div')
    cardElRef.current.className = 'wm2d-card'
  }

  // ── Создание карты (один раз); стиль — по теме на момент монтирования ──
  useEffect(() => {
    if (!boxRef.current) return
    styleThemeRef.current = colorsRef.current.theme
    const map = new maplibregl.Map({
      container: boxRef.current,
      style: BASEMAP_STYLE[colorsRef.current.theme],
      center: [59.5, 55],
      zoom: 5,
      attributionControl: { compact: true },
    })
    mapRef.current = map
    popupRef.current = new maplibregl.Popup({ offset: 22, closeButton: false, className: 'wm2d-popup' })
    if (import.meta.env.DEV) (window as unknown as { __wmMap: maplibregl.Map }).__wmMap = map
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')
    map.on('click', () => cbRef.current.onBackground?.())
    // Первая загрузка И каждая смена стиля: подписи, слои дорог с последними трассами.
    map.on('style.load', () => {
      const c = colorsRef.current
      styleLabels(map, c)
      ensureRouteLayers(map, c, routeDataRef.current)
      if (!readyRef.current) { readyRef.current = true; map.fire('wm2d:ready') }
    })
    return () => {
      readyRef.current = false
      markersRef.current.clear()
      popupRef.current = null
      map.remove()
      mapRef.current = null
    }
  }, [])

  // ── Смена темы → подложка по теме (стиль перезагружается, слои восстанавливаются) ──
  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    if (styleThemeRef.current !== colors.theme) {
      styleThemeRef.current = colors.theme
      map.setStyle(BASEMAP_STYLE[colors.theme])
      return
    }
    styleLabels(map, colors)
    applyRouteColors(map, colors)
  }, [colors])

  // ── Маркеры-пины ──
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const build = () => {
      const store = markersRef.current
      for (const marker of store.values()) marker.remove()
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
        const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat(lngLat).addTo(map)
        el.addEventListener('mouseenter', () => {
          const popup = popupRef.current, card = cardElRef.current
          if (!popup || !card) return
          setHoverId(node.id)
          popup.setLngLat(lngLat).setDOMContent(card).addTo(map)
        })
        el.addEventListener('mouseleave', () => {
          if (node.id === selectedId) return
          popupRef.current?.remove()
          setHoverId((h) => (h === node.id ? null : h))
        })
        el.addEventListener('click', (e) => { e.stopPropagation(); cbRef.current.onSelect(node.id) })
        el.addEventListener('dblclick', (e) => { e.stopPropagation(); cbRef.current.onEnter(node.id) })
        store.set(node.id, marker)
      }
      // Первое авто-кадрирование по узлам.
      if (!fittedRef.current && placed.length) {
        const b = new maplibregl.LngLatBounds()
        for (const { lngLat } of placed) b.extend(lngLat)
        map.fitBounds(b, { padding: 90, maxZoom: 8, duration: 0 })
        fittedRef.current = true
      }
    }
    if (readyRef.current) build()
    else map.once('wm2d:ready', build)
  }, [placed, selectedId])

  // ── Дороги: прямые линии сразу + реальные трассы OSRM асинхронно ──
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const ac = new AbortController()
    const posById = new Map(placed.map((p) => [p.node.id, p.lngLat]))
    const segs = edges
      .map((e) => ({ id: e.id, a: posById.get(e.from), b: posById.get(e.to) }))
      .filter((s): s is { id: string; a: LngLat; b: LngLat } => !!s.a && !!s.b)

    const apply = (feats: GeoJSON.Feature[]) => {
      routeDataRef.current = { type: 'FeatureCollection', features: feats }
      setRouteData(map, routeDataRef.current)
    }
    const run = () => {
      const feats = segs.map((s) => straightLine(s.a, s.b))
      apply(feats)
      segs.forEach((s, i) => {
        fetchRoadRoute(s.a, s.b, ac.signal).then((road) => {
          if (!road || ac.signal.aborted) return
          apply(feats.map((f, j) => (j === i ? road : f)))
          feats[i] = road
        })
      })
    }
    if (readyRef.current) run()
    else map.once('wm2d:ready', run)
    return () => ac.abort()
  }, [edges, placed])

  const hovered = hoverId ? placed.find((p) => p.node.id === hoverId)?.node : undefined
  return (
    <div className="wm2d">
      <div className="wm2d__map" ref={boxRef} />
      {hovered && cardElRef.current && createPortal(<MapCard node={hovered} stats={stats.get(hovered.id)} />, cardElRef.current)}
    </div>
  )
}
