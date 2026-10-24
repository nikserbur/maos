/**
 * Ответ MENTAT по утверждениям: у каждого — бейдж проверки верности (✓ сверено / ⚠ число не совпало /
 * ✕ нет ссылки / ✕ неизвестный узел) и чипы ссылок, ведущие на узлы карты. Числа в подсказке бейджа —
 * с чем именно они сверены. Пересказ без ссылок и чисел («Почему:») показывается как подзаголовок.
 */
import { num } from '../../explain/format'
import { Chip } from '../../ui/kit'
import { getNode } from '../method-map/registry'
import { mapAnchor } from './context'
import type { ClaimCheck, ClaimVerdict, VerifyReport } from './verify'

const VERDICT: Readonly<Record<Exclude<ClaimVerdict, 'free'>, { text: string; cls: string }>> = {
  verified: { text: '✓ сверено', cls: 'ok' },
  cited: { text: '✓ со ссылкой', cls: 'ok' },
  mismatch: { text: '⚠ число не совпало', cls: 'warn' },
  uncited: { text: '✕ нет ссылки', cls: 'bad' },
  unknown_node: { text: '✕ неизвестный узел', cls: 'bad' },
}

function numbersTitle(c: ClaimCheck): string | undefined {
  if (!c.numbers.length) return undefined
  return c.numbers.map((n) => (n.match
    ? `${n.raw} = ${n.match.text}${n.match.absOnly ? ' (по модулю)' : ''} · ${n.match.nodeId}`
    : `${n.raw} — нет такого значения в узлах ссылки`)).join('\n')
}

interface RowProps {
  c: ClaimCheck
  titles: Readonly<Record<string, string>>
  anchors: Readonly<Record<string, string>>
}

function ClaimRow({ c, titles, anchors }: RowProps) {
  if (c.verdict === 'free') {
    const heading = /:$/.test(c.text) && c.text.length < 40
    return <li className={heading ? 'mt-claim mt-claim--head' : 'mt-claim mt-claim--free'}><span className="mt-claim__t">{c.text}</span></li>
  }
  const v = VERDICT[c.verdict]
  return (
    <li className={`mt-claim mt-claim--${v.cls}`}>
      <span className="mt-claim__t">{c.text}</span>
      <span className="mt-claim__meta">
        <span title={numbersTitle(c)}><Chip size="sm" className={`mt-verdict mt-verdict--${v.cls}`}>{v.text}</Chip></span>
        {c.citations.map((id) => {
          if (c.unknown.includes(id)) return <span key={id} className="mt-cite mt-cite--bad" title="Узла нет в контексте вопроса">{id}</span>
          const anchor = anchors[id] ?? mapAnchor(id)
          const label = titles[id] ?? getNode(id)?.title ?? id
          return anchor
            ? <a key={id} className="mt-cite" href={`#/map/${encodeURIComponent(anchor)}`} title={`${id} — открыть на карте`}>{label}</a>
            : <span key={id} className="mt-cite" title={id}>{label}</span>
        })}
      </span>
    </li>
  )
}

interface Props {
  report: VerifyReport
  /** id узла → подпись (из контекста вопроса). */
  titles?: Readonly<Record<string, string>>
  /** id узла → узел карты для перехода (факты и разности → их узел). */
  anchors?: Readonly<Record<string, string>>
}

const NONE: Readonly<Record<string, string>> = {}

export function AnswerView({ report, titles = NONE, anchors = NONE }: Props) {
  const ok = report.counts.verified + report.counts.cited
  const bad = report.counts.uncited + report.counts.unknown_node
  return (
    <section className="mt-answer" aria-label="Ответ MENTAT с проверкой верности">
      <p className={`mt-answer__sum${report.pass ? '' : ' is-fail'}`} role="status">
        Проверка верности: {report.pass ? 'пройдена' : 'не пройдена'} · ✓ {num(ok, 0)} · ⚠ {num(report.counts.mismatch, 0)} · ✕ {num(bad, 0)}
      </p>
      <ul className="mt-claims">
        {report.claims.map((c) => <ClaimRow key={c.index} c={c} titles={titles} anchors={anchors} />)}
      </ul>
    </section>
  )
}
