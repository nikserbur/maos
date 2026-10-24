/**
 * Диаграмма потоков «откуда → куда» (X1 §6.3 п. 5): два столбца узлов, ленты толщиной ∝ величине,
 * подписи не обрезаются и без многоточий (до 3 строк; поле подписи растёт по тексту, полное имя — в
 * подсказке), наведение на узел подсвечивает его цепочку и показывает числа, остальные ленты
 * приглушаются; `emphasis` — узлы, о которых вывод (их ленты в цвете, прочие — «прочее» 15 %);
 * топ-N переходов подписаны числом на ленте.
 */
import { useState, type ReactNode } from 'react'
import { ChartFrame, type ChartTable } from './ChartFrame'
import { useMeasuredWidth } from './hooks'
import { num } from '../../explain/format'

export interface SankeyLink { from: string; to: string; value: number }

interface SankeyProps {
  /** Узлы в порядке стадий (сверху вниз). */
  nodes: ReadonlyArray<{ id: string; label: string }>
  links: ReadonlyArray<SankeyLink>
  fmt?: (v: number) => string
  unit?: string
  /** Сколько самых толстых лент подписать числом. */
  topN?: number
  title?: ReactNode
  subtitle?: ReactNode
  ariaLabel?: string
  className?: string
  /** Узлы вывода: их ленты — цветом ряда, прочие — нейтральным «прочее» 15 %. */
  emphasis?: ReadonlyArray<string>
}

const ROW = 52
const MAX_LINES = 3

/** Перенос по словам без обрезки: поле расширяется, пока подпись не уляжется в 3 строки. */
export function wrapFull(text: string, maxChars: number, maxLines = MAX_LINES): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean)
  const longest = words.reduce((m, w) => Math.max(m, w.length), 1)
  for (let width = Math.max(maxChars, longest); ; width++) {
    const lines: string[] = []
    let cur = ''
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w
      if (next.length <= width) { cur = next; continue }
      lines.push(cur)
      cur = w
    }
    if (cur) lines.push(cur)
    if (lines.length <= maxLines || width > text.length) return lines
  }
}
const PAD = 14
const MAX_LABEL = 26

export function Sankey({ nodes, links, fmt = (v) => num(v, 0), unit = 'партий', topN = 5, title, subtitle, ariaLabel, className, emphasis }: SankeyProps) {
  const [ref, width] = useMeasuredWidth<HTMLDivElement>()
  const [hot, setHot] = useState<string | null>(null)
  const labelOf = (id: string) => nodes.find((n) => n.id === id)?.label ?? id
  const wrapped = new Map(nodes.map((n) => [n.id, wrapFull(n.label, MAX_LABEL)]))
  const emph = emphasis && emphasis.length ? new Set(emphasis) : null
  const isEmph = (l: SankeyLink) => !emph || emph.has(l.from) || emph.has(l.to)
  const maxChars = Math.max(6, ...[...wrapped.values()].flat().map((l) => l.length))
  const labelW = Math.min(320, maxChars * 6.8 + 12)
  const H = nodes.length * ROW + PAD * 2
  const leftX = labelW + 8
  const rightX = Math.max(leftX + 120, width - labelW - 8)
  const yOf = (id: string) => PAD + nodes.findIndex((n) => n.id === id) * ROW + ROW / 2
  const maxV = Math.max(1, ...links.map((l) => l.value))
  const ranked = [...links].sort((a, b) => b.value - a.value)
  const labelled = new Set(ranked.slice(0, topN))
  const isHot = (l: SankeyLink) => hot === null || l.from === hot || l.to === hot
  const outOf = (id: string) => links.filter((l) => l.from === id).reduce((a, l) => a + l.value, 0)
  const inOf = (id: string) => links.filter((l) => l.to === id).reduce((a, l) => a + l.value, 0)
  const table: ChartTable = { columns: ['Откуда', 'Куда', unit], rows: ranked.map((l) => [labelOf(l.from), labelOf(l.to), fmt(l.value)]), numeric: [2] }
  const empty = nodes.length < 2 || links.length === 0

  return (
    <ChartFrame title={title} subtitle={subtitle} ariaLabel={ariaLabel ?? `Потоки: ${nodes.length} узлов, ${links.length} переходов`}
      table={empty ? null : table} empty={empty ? 'Недостаточно данных для диаграммы потоков' : undefined} className={className}>
      <div ref={ref} className="ch-plot" onPointerLeave={() => setHot(null)}>
        <svg className="ch-svg ch-sankey" width={width} height={H} viewBox={`0 0 ${width} ${H}`}>
          {links.map((l, i) => {
            const y1 = yOf(l.from)
            const y2 = yOf(l.to)
            const sw = 1.5 + (l.value / maxV) * 16
            const mx = (leftX + rightX) / 2
            return (
              <g key={i} className={`ch-sankey__link${isHot(l) ? '' : ' is-dim'}${hot && isHot(l) ? ' is-hot' : ''}${isEmph(l) ? '' : ' is-other'}`}>
                <path d={`M ${leftX} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${rightX} ${y2}`} strokeWidth={sw} />
                {(labelled.has(l) || (hot && isHot(l))) && (
                  <text className="ch-sankey__value" x={mx} y={(y1 + y2) / 2 + 4} textAnchor="middle">{fmt(l.value)}</text>
                )}
              </g>
            )
          })}
          {nodes.map((n) => {
            const y = yOf(n.id)
            const lines = wrapped.get(n.id) ?? [n.label]
            const dy0 = 4 - ((lines.length - 1) * 13) / 2
            const hotNode = hot === n.id
            return (
              <g key={n.id} className={`ch-sankey__node${hotNode ? ' is-hot' : ''}`} tabIndex={0}
                onPointerEnter={() => setHot(n.id)} onFocus={() => setHot(n.id)} onBlur={() => setHot(null)}>
                <title>{`${n.label}: вход ${fmt(inOf(n.id))}, выход ${fmt(outOf(n.id))} ${unit}`}</title>
                <text className="ch-sankey__label" x={leftX - 10} y={y + dy0} textAnchor="end">
                  {lines.map((ln, i) => <tspan key={i} x={leftX - 10} dy={i ? 13 : 0}>{ln}</tspan>)}
                </text>
                <circle className="ch-sankey__port" cx={leftX} cy={y} r={5} />
                <circle className="ch-sankey__port" cx={rightX} cy={y} r={5} />
                <text className="ch-sankey__label ch-sankey__label--right" x={rightX + 10} y={y + dy0}>
                  {lines.map((ln, i) => <tspan key={i} x={rightX + 10} dy={i ? 13 : 0}>{ln}</tspan>)}
                </text>
                <rect className="ch-sankey__hit" x={0} y={y - ROW / 2} width={width} height={ROW} />
              </g>
            )
          })}
        </svg>
      </div>
    </ChartFrame>
  )
}
