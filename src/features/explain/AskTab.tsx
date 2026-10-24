/**
 * Вкладка «Вопрос»: узел вопроса (выделенный на карте или узел шаблона), чипы шаблонов, чего не хватает
 * для ответа, прогон для сравнения, поле вопроса, «Спросить» / «Показать промпт» и ответ с проверкой
 * верности. Без подключённой модели — честное пустое состояние: ответа нет, промпт доступен.
 */
import { useId } from 'react'
import { dateTime, num } from '../../explain/format'
import type { OptRunSummary } from '../../lib/api'
import { ChoiceChip, EmptyState, ErrorBanner, IconButton } from '../../ui/kit'
import { getNode } from '../method-map/registry'
import { AnswerView } from './AnswerView'
import { mapAnchor } from './context'
import { NEED_LABEL, type Need, type TaskTemplate } from './prompts'
import type { VerifyReport } from './verify'

export type AskPhase = 'idle' | 'asking' | 'answered' | 'not_connected' | 'error'

export interface AnswerState {
  report: VerifyReport
  model: string
  ms: number
}

interface Props {
  templates: readonly TaskTemplate[]
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
  phase: AskPhase
  error: string | null
  answer: AnswerState | null
  titles: Readonly<Record<string, string>>
  anchors: Readonly<Record<string, string>>
  onAsk: () => void
  onShowPrompt: () => void
  onSettings: () => void
}

export function AskTab(p: Props) {
  const id = useId()
  const node = getNode(p.asked)
  const askedTitle = node?.title ?? p.titles[p.asked] ?? p.asked
  const asking = p.phase === 'asking'
  return (
    <div className="mt-ask">
      <p className="mt-asked">
        <span className="text-caps mt-h">Узел вопроса</span>
        <a className="mt-cite" href={`#/map/${encodeURIComponent(p.anchors[p.asked] ?? mapAnchor(p.asked) ?? p.asked)}`} title={p.asked}>{askedTitle}</a>
        {p.focus && p.focus === p.asked && <IconButton icon="close" size="sm" variant="ghost" onClick={p.onClearFocus} title="Снять выделенный узел — вернуться к узлу шаблона" />}
      </p>

      <div className="mt-chips" role="group" aria-label="Шаблоны вопросов">
        {p.templates.map((t) => (
          <ChoiceChip key={t.id} pressed={t.id === p.template.id} onToggle={() => p.onTemplate(t.id)} title={t.question}>{t.label}</ChoiceChip>
        ))}
        <ChoiceChip pressed={p.template.id === 'custom'} onToggle={() => p.onTemplate('custom')} title="Свой вопрос об узле">Свой вопрос</ChoiceChip>
      </div>

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
              <option key={r.id} value={r.id}>{dateTime(r.created_at)} · {r.objective} · α {r.alpha} · N {r.samples}</option>
            ))}
          </select>
        </label>
      )}

      <label className="form__field" htmlFor={`${id}-q`}>
        <span className="form__label">Вопрос</span>
        <textarea id={`${id}-q`} className="form__textarea" rows={3} maxLength={1000} value={p.question}
          placeholder={p.placeholder} onChange={(e) => p.onQuestion(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); p.onAsk() } }} />
        <span className="form__hint">Пусто — вопрос из подсказки. Cmd/Ctrl+Enter — спросить.</span>
      </label>

      <div className="mt-row">
        <button type="button" className="btn btn--primary" onClick={p.onAsk} disabled={asking}>{asking ? 'Модель отвечает…' : 'Спросить'}</button>
        <IconButton icon="search" variant="ghost" onClick={p.onShowPrompt} title="Точный текст запроса: правила, контекст графа, вопрос">Показать промпт</IconButton>
      </div>

      {p.phase === 'not_connected' && (
        <EmptyState size="sm" variant="flow" title="Локальная модель не подключена"
          action={<div className="mt-row"><IconButton icon="search" onClick={p.onShowPrompt}>Показать промпт</IconButton><IconButton icon="gear" variant="ghost" onClick={p.onSettings}>Подключение</IconButton></div>}>
          Ответа нет и он не имитируется. Промпт можно посмотреть и скопировать — это ровно то, что получит модель.
        </EmptyState>
      )}
      {p.phase === 'error' && p.error && <ErrorBanner title="Модель не ответила" message={p.error} onRetry={p.onAsk} />}
      {p.answer && p.phase === 'answered' && (
        <>
          <p className="mt-muted">Ответ модели <span className="mono">{p.answer.model}</span> за {num(p.answer.ms / 1000, 1)} с · проверен по узлам контекста</p>
          <AnswerView report={p.answer.report} titles={p.titles} anchors={p.anchors} />
        </>
      )}
    </div>
  )
}
