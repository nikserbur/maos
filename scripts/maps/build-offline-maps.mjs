/**
 * Предустановленные карты уровня «Мир» (без внешних серверов во время работы приложения).
 *
 * Разовая подготовка данных (при обновлении карт): из открытой сборки Protomaps (данные OpenStreetMap,
 * ODbL) вырезаются векторные тайлы региона площадок, к ним — стиль Protomaps (тёмный и светлый, подписи
 * по-русски), шрифты Noto Sans, значки и заранее рассчитанные дорожные маршруты между площадками.
 * Результат — статические файлы public/maps/** и стили src/features/plant-scene/worldmap2d/styles/*.json.
 *
 * Запуск: cd scripts/maps && npm install && npm run build   (нужен интернет только здесь)
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { PMTiles } from 'pmtiles'
import { layers, namedFlavor } from '@protomaps/basemaps'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const OUT = path.join(ROOT, 'public/maps')
const STYLES = path.join(ROOT, 'src/features/plant-scene/worldmap2d/styles')
const BUILD = process.env.PMTILES_BUILD ?? '20261103'
const SRC = `https://build.protomaps.com/${BUILD}.pmtiles`
const ASSETS = 'https://protomaps.github.io/basemaps-assets'

/** Регион: обзорные масштабы — Урал с окрестностями, детальные — район площадок демо-холдинга. */
export const REGION_WIDE = { w: 40, s: 48, e: 80, n: 66 }      // z0–6
export const REGION_SITES = { w: 54, s: 52.5, e: 64, n: 58.5 } // z7–8
const Z_WIDE = 6, Z_MAX = 8

/** Площадки демо-холдинга (как в src/features/plant-scene/worldmap2d/cities.ts). */
const SITES = {
  'Магнитогорск': [59.0, 53.41], 'Челябинск': [61.4, 55.16], 'Екатеринбург': [60.65, 56.84], 'Уфа': [55.97, 54.74],
}
const FONTS = ['Noto Sans Regular', 'Noto Sans Medium', 'Noto Sans Italic']
// Диапазоны глифов: латиница, расширенная латиница, кириллица, знаки пунктуации и символы.
const RANGES = ['0-255', '256-511', '512-767', '768-1023', '1024-1279', '1280-1535', '7680-7935', '8192-8447', '8448-8703', '8704-8959', '9472-9727']

const lon2x = (lon, z) => Math.floor((lon + 180) / 360 * 2 ** z)
const lat2y = (lat, z) => { const r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z) }
const clampXY = (v, z) => Math.max(0, Math.min(2 ** z - 1, v))

async function download(url, file) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()))
}

async function tiles() {
  const p = new PMTiles(SRC)
  const h = await p.getHeader()
  if (h.tileType !== 1) throw new Error('ожидались векторные тайлы MVT')
  let n = 0, bytes = 0
  for (let z = 0; z <= Z_MAX; z++) {
    const b = z <= Z_WIDE ? REGION_WIDE : REGION_SITES
    const x0 = clampXY(lon2x(b.w, z), z), x1 = clampXY(lon2x(b.e, z), z)
    const y0 = clampXY(lat2y(b.n, z), z), y1 = clampXY(lat2y(b.s, z), z)
    const jobs = []
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) jobs.push([x, y])
    for (let i = 0; i < jobs.length; i += 8) {
      await Promise.all(jobs.slice(i, i + 8).map(async ([x, y]) => {
        const t = await p.getZxy(z, x, y)
        if (!t) return
        const gz = zlib.gzipSync(Buffer.from(t.data), { level: 9 })
        const f = path.join(OUT, 'tiles', String(z), String(x), `${y}.mvt.gz`)
        fs.mkdirSync(path.dirname(f), { recursive: true })
        fs.writeFileSync(f, gz)
        n++; bytes += gz.length
      }))
    }
    console.log(`z${z}: ${jobs.length} тайлов`)
  }
  console.log(`тайлы: ${n}, ${(bytes / 1e6).toFixed(1)} МБ (gzip)`)
  return { minzoom: 0, maxzoom: Z_MAX, build: BUILD, version: h.specVersion }
}

async function fonts() {
  for (const font of FONTS) for (const r of RANGES) {
    await download(`${ASSETS}/fonts/${encodeURIComponent(font)}/${r}.pbf`, path.join(OUT, 'fonts', font, `${r}.pbf`))
  }
}

async function sprites() {
  for (const flavor of ['dark', 'light']) for (const sfx of ['.json', '.png', '@2x.json', '@2x.png']) {
    await download(`${ASSETS}/sprites/v4/${flavor}${sfx}`, path.join(OUT, 'sprites', `${flavor}${sfx}`))
  }
}

/** Стиль без адресов: источник, шрифты и значки подставляет basemap.ts (локальные пути приложения). */
function styles() {
  fs.mkdirSync(STYLES, { recursive: true })
  for (const flavor of ['dark', 'light']) {
    const style = { version: 8, layers: layers('protomaps', namedFlavor(flavor), { lang: 'ru' }) }
    fs.writeFileSync(path.join(STYLES, `${flavor}.json`), JSON.stringify(style))
  }
}

/** Douglas–Peucker по градусам: трасса для обзорной карты без лишних точек. */
function simplify(pts, eps) {
  if (pts.length < 3) return pts
  const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1]
  let idx = 0, dmax = 0
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i]
    const d = Math.abs((by - ay) * px - (bx - ax) * py + bx * ay - by * ax) / Math.hypot(by - ay, bx - ax || 1e-12)
    if (d > dmax) { dmax = d; idx = i }
  }
  if (dmax <= eps) return [pts[0], pts[pts.length - 1]]
  return [...simplify(pts.slice(0, idx + 1), eps).slice(0, -1), ...simplify(pts.slice(idx), eps)]
}

/** Маршруты между всеми парами площадок — разово через OSRM, в приложении — из файла. */
async function routes() {
  const names = Object.keys(SITES), out = []
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
    const a = SITES[names[i]], b = SITES[names[j]]
    const url = `https://router.project-osrm.org/route/v1/driving/${a[0]},${a[1]};${b[0]},${b[1]}?overview=full&geometries=geojson`
    const r = await fetch(url); const jj = await r.json()
    const coords = jj?.routes?.[0]?.geometry?.coordinates
    if (!Array.isArray(coords)) { console.warn('нет маршрута', names[i], names[j]); continue }
    const line = simplify(coords, 0.003).map(([x, y]) => [+x.toFixed(4), +y.toFixed(4)])
    out.push({ from: names[i], to: names[j], a, b, km: Math.round(jj.routes[0].distance / 1000), line })
    await new Promise((res) => setTimeout(res, 1100))   // вежливый темп к публичному OSRM
  }
  fs.writeFileSync(path.join(OUT, 'routes.json'), JSON.stringify({ source: 'OSRM (OpenStreetMap)', routes: out }))
  console.log(`маршруты: ${out.length}`)
}

fs.mkdirSync(OUT, { recursive: true })
const meta = await tiles()
await fonts()
await sprites()
styles()
await routes()
fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify({ ...meta, regionWide: REGION_WIDE, regionSites: REGION_SITES, created: new Date().toISOString().slice(0, 10) }))
console.log('готово:', OUT)
