/**
 * Вкладка «Вопрос» (X2 P-130): узел вопроса, до пяти шаблонов этого экрана и «Ещё вопросы (N)», строка
 * охвата (что видит модель, сколько токенов, что не вошло), поле вопроса, «Спросить» / «Остановить» и
 * ответ с проверкой верности и постоянной меткой «MENTAT · ИИ · модель · локально». Модель не подключена —
 * сначала честное пустое состояние с «Подключить модель»; ответа нет и он не имитируется.
 */
import { useId, useState } from 'react'
import { countText, dateTime, num, pct } from '../../explain/format'
import { objectiveLabel } from '../../explain/labels'
import type { OptRunSummary } from '../../lib/api'
import { ChoiceChip, EmptyState, ErrorBanner, IconButton } from '../../ui/kit'
import { getNode } from '../method-map/registry'
import { AnswerView } from './AnswerView'
import { mapAnchor } from './context'
import type { MentatContext } from './context'
import { NEED_LABEL, type Need, type TaskTemplate } from './prompts'
import type { VerifyReport } from './verify'

export type AskPhase = 'idle' | 'asking' | 'answered' | 'stopped' | 'not_connected' | 'error'

export interface AnswerState {
  report: VerifyReport
  model: string
  ms: number
}

interface Props {
  own: readonly TaskTemplate[]
  more: readonly TaskTemplate[]
  template: TaskTemplate
  onTemplate: (id: string) => void
  asked: string
  focus: string | null
  onClearFocus: () => void
  question: string
  /** Вопрос по умолчанию (шаблона или «об узле»). */
  placeholder: string
  onQuestion: (q: string) => void
  missing: readonly Need[]
  runs: readonly OptRunSummary[]
  compareRunId: string
  onCompare: (id: string) => void
  context: MentatContext
  /** true — модель подключена, false — нет, null — статус ещё не получен. */
  connected: boolean | null
  phase: AskPhase
  /** Секунд с начала запроса (пока модель отвечает). */
  elapsed: number
  error: string | null
  answer: AnswerState | null
  titles: Readonly<Record<string, string>>
  anchors: Readonly<Record<string, string>>
  onAsk: () => void
  onStop: () => void
  onShowPrompt: () => void
  onSettings: () => void
}

const NODE_FORMS = ['узел', 'узла', 'узлов'] as const

/** «MENTAT · ИИ · qwen2.5 · локально» — метка ответа ИИ (на ответе и в истории). */
export const aiLabel = (model: string): string => `MENTAT · ИИ · ${model || 'модель'} · локально`

/** Охват контекста: что видит модель и что не вошло по бюджету токенов. */
function ScopeLine({ context, onShowPrompt }: { context: MentatContext; onShowPrompt: () => void }) {
  const t = context.truncated
  return (
    <p className="mt-scope">
      <span>Видит: {countText(t.kept, NODE_FORMS)} графа этого экрана</span>
      <span>≈{num(t.usedTokens / 1000, 1)} из {num(t.budgetTokens / 1000, 0)} тыс. токенов</span>
      {t.dropped > 0 && (
        <button type="button" className="mt-scope__more" onClick={onShowPrompt} title="Что вошло и что нет — вкладка «Промпт»">
          <span className="glyph-setup" aria-hidden="true" />не вошло {num(t.dropped, 0)}
        </button>
      )}
      <span>локальная модель</span>
      <span>ничего не меняет в данных</span>
    </p>
  )
}

function TemplateChips({ own, more, template, onTemplate }: Pick<Props, 'own' | 'more' | 'template' | 'onTemplate'>) {
  const inMore = more.some((t) => t.id === template.id)
  const [open, setOpen] = useState(inMore)
  const chip = (t: TaskTemplate) => <ChoiceChip key={t.id} pressed={t.id === template.id} onToggle={() => onTemplate(t.id)} title={t.question}>{t.label}</ChoiceChip>
  return (
    <div className="mt-chips" role="group" aria-label="Шаблоны вопросов">
      {own.map(chip)}
      <ChoiceChip pressed={template.id === 'custom'} onToggle={() => onTemplate('custom')} title="Свой вопрос об узле">Свой вопрос</ChoiceChip>
      {more.length > 0 && (
        <button type="button" className="mt-more" aria-expanded={open || inMore} onClick={() => setOpen((v) => !v)}>
          Ещё вопросы ({num(more.length, 0)}) {open || inMore ? '▾' : '▸'}
        </button>
      )}
      {(open || inMore) && more.map(chip)}
    </div>
  )
}

export function AskTab(p: Props) {
  const id = useId()
  const node = getNode(p.asked)
  const askedTitle = node?.title ?? p.titles[p.asked] ?? p.asked
  const asking = p.phase === 'asking'
  const offline = p.connected === false
  return (
    <div className="mt-ask">
      {offline && (
        <EmptyState size="sm" variant="flow" title="Локальная модель не подключена"
          action={<div className="mt-row">
            <button type="button" className="btn btn--primary btn--sm" onClick={p.onSettings}>Подключить модель</button>
            <button type="button" className="btn btn--sm" onClick={p.onShowPrompt}>Показать промпт</button>
          </div>}>
          Ответов нет и они не имитируются. Промпт можно посмотреть и скопировать — это ровно то, что получит модель.
        </EmptyState>
      )}

      <p className="mt-asked">
        <span className="text-caps mt-h">Узел вопроса</span>
        <a className="mt-cite" href={`#/map/${encodeURIComponent(p.anchors[p.asked] ?? mapAnchor(p.asked) ?? p.asked)}`} title={askedTitle}>{askedTitle}</a>
        {p.focus && p.focus === p.asked && <IconButton icon="close" size="sm" variant="ghost" onClick={p.onClearFocus} title="Снять выделенный узел — вернуться к узлу шаблона" />}
      </p>

      <TemplateChips own={p.own} more={p.more} template={p.template} onTemplate={p.onTemplate} />
      <ScopeLine context={p.context} onShowPrompt={p.onShowPrompt} />

      {p.missing.length > 0 && (
        <ErrorBanner tone="setup" title="Для ответа не хватает расчёта"
          message={`${p.missing.map((n) => NEED_LABEL[n]).join('; ')}. Без него модель обязана ответить «в контексте нет данных».`} />
      )}

      {p.template.needs.includes('compare') && (
        <label className="form__field" htmlFor={`${id}-cmp`}>
          <span className="form__label">Прогон для сравнения</span>
          <select id={`${id}-cmp`} className="form__select" value={p.compareRunId} onChange={(e) => p.onCompare(e.target.value)}>
            <option value="">— выберите прогон портфеля —</option>
            {p.runs.map((r) => (
              <option key={r.id} value={r.id}>{dateTime(r.created_at)} · {objectiveLabel(r.objective)} · α {pct(Number(r.alpha), 0)} · N {num(Number(r.samples), 0)}</option>
            ))}
          </select>
        </label>
      )}

      <label className="form__field" htmlFor={`${id}-q`}>
        <span className="form__label">Вопрос</span>
        <textarea id={`${id}-q`} className="form__textarea" rows={3} maxLength={1000} value={p.question}
          placeholder={p.placeholder} onChange={(e) => p.onQuestion(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (!asking) p.onAsk() } }} />
        <span className="form__hint">Пусто — вопрос из подсказки. Cmd/Ctrl+Enter — спросить.</span>
      </label>

      <div className="mt-row">
        <button type="button" className={`btn ${offline ? '' : 'btn--primary'}`} aria-disabled={asking || undefined}
          onClick={() => { if (!asking) p.onAsk() }}>
          {asking ? `Модель отвечает… ${num(p.elapsed, 0)} с` : 'Спросить'}
        </button>
        {asking && <button type="button" className="btn btn--ghost" onClick={p.onStop}>Остановить</button>}
        {!asking && !offline && <IconButton icon="search" variant="ghost" onClick={p.onShowPrompt} title="Точный текст запроса: правила, контекст графа, вопрос">Показать промпт</IconButton>}
      </div>

      {p.phase === 'idle' && !p.answer && !offline && (
        <ul className="mt-can">
          <li><b>Умеет:</b> объяснить, почему число такое, по графу расчёта; каждое утверждение — со ссылкой на узел карты, каждое число сверяется.</li>
          <li><b>Не умеет:</b> менять данные, пересчитывать и отвечать без расчёта — тогда скажет «в контексте нет данных».</li>
        </ul>
      )}

      <section className="mt-out" role="log" aria-live="polite" aria-busy={asking} aria-label="Ответ MENTAT">
        {p.phase === 'not_connected' && !offline && (
          <EmptyState size="sm" variant="flow" title="Локальная модель не подключена"
            action={<div className="mt-row"><button type="button" className="btn btn--primary btn--sm" onClick={p.onSettings}>Подключить модель</button><button type="button" className="btn btn--sm" onClick={p.onShowPrompt}>Показать промпт</button></div>}>
            Сервер ответил, что модель не настроена. Ответа нет и он не имитируется.
          </EmptyState>
        )}
        {p.phase === 'stopped' && <p className="mt-muted">Запрос остановлен — ответа нет. Можно спросить снова.</p>}
        {p.phase === 'error' && p.error && <ErrorBanner title="Модель не ответила" message="Проверьте подключение во вкладке «Подключение» и повторите." detail={p.error} onRetry={p.onAsk} />}
        {p.answer && p.phase === 'answered' && (
          <>
            <p className="mt-ai">{aiLabel(p.answer.model)} · за {num(p.answer.ms / 1000, 1)} с · проверен по узлам контекста</p>
            <AnswerView report={p.answer.report} titles={p.titles} anchors={p.anchors} />
          </>
        )}
      </section>
    </div>
  )
}
