/**
 * Экспорт графика в SVG (UX-V2 §7 G4: «экспорт SVG для диплома»): копия SVG тела графика с
 * вычисленными стилями, вписанными в атрибут `style` каждого элемента КОПИИ (в документе стили
 * остаются классами и токенами темы) — файл открывается без CSS приложения и в текущей теме.
 * Плюс подложка цвета поверхности и шрифт. Чистые части (`styleText`, `svgFileName`) — под тестом.
 */
export const EXPORT_PROPS: readonly string[] = [
  'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin',
  'opacity', 'font-family', 'font-size', 'font-weight', 'text-anchor', 'dominant-baseline', 'visibility', 'display',
]

/** Строка `style` из вычисленных значений: пустые и значения по умолчанию опускаются. */
export function styleText(get: (prop: string) => string, props: readonly string[] = EXPORT_PROPS): string {
  const skip: Readonly<Record<string, string>> = { opacity: '1', 'fill-opacity': '1', 'stroke-opacity': '1', visibility: 'visible', 'stroke-dasharray': 'none' }
  return props
    .map((p) => [p, get(p).trim()] as const)
    .filter(([p, v]) => v !== '' && v !== 'normal' && skip[p] !== v)
    .map(([p, v]) => `${p}:${v}`)
    .join(';')
}

/** Имя файла: заголовок графика без служебных символов + дата. */
export function svgFileName(title: string, date = new Date()): string {
  const base = title.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'график'
  const d = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  return `${base}_${d}.svg`
}

/** Самый крупный SVG внутри тела графика (сам график, не образцы легенды). */
export function mainSvg(root: Element | null): SVGSVGElement | null {
  if (!root) return null
  const all = Array.from(root.querySelectorAll('svg'))
  let best: SVGSVGElement | null = null
  let area = 0
  for (const s of all) {
    const r = s.getBoundingClientRect()
    if (r.width * r.height > area) { area = r.width * r.height; best = s }
  }
  return best
}

export function serializeSvg(svg: SVGSVGElement, background: string): string {
  const rect = svg.getBoundingClientRect()
  const clone = svg.cloneNode(true) as SVGSVGElement
  const src = [svg, ...Array.from(svg.querySelectorAll('*'))]
  const dst = [clone, ...Array.from(clone.querySelectorAll('*'))]
  src.forEach((el, i) => {
    const cs = getComputedStyle(el)
    const st = styleText((p) => cs.getPropertyValue(p))
    if (st) dst[i].setAttribute('style', st)
    dst[i].removeAttribute('class')
  })
  const w = Math.round(rect.width)
  const h = Math.round(rect.height)
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('width', String(w))
  clone.setAttribute('height', String(h))
  if (!clone.getAttribute('viewBox')) clone.setAttribute('viewBox', `0 0 ${w} ${h}`)
  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  bg.setAttribute('x', '0'); bg.setAttribute('y', '0'); bg.setAttribute('width', '100%'); bg.setAttribute('height', '100%')
  bg.setAttribute('fill', background)
  clone.insertBefore(bg, clone.firstChild)
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`
}

export function downloadSvg(text: string, name: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}
