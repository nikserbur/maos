/**
 * История вопросов проекта: настоящие ответы модели с вердиктом проверки верности; раскрыть, копировать,
 * экспорт в Markdown, очистить. Пустая история — честное пустое состояние.
 */
import { useState } from 'react'
import { dateTime } from '../../explain/format'
import { Chip, EmptyState, IconButton } from '../../ui/kit'
import { AnswerView } from './AnswerView'
import { copyText, downloadText } from './exportText'
import { exportMarkdown, type HistoryEntry } from './llm/history'

const pick = (e: HistoryEntry, k: 'title' | 'mapNode'): Record<string, string> =>
  Object.fromEntries(Object.entries(e.cited ?? {}).map(([id, v]) => [id, v[k]]))

interface Props {
  entries: readonly HistoryEntry[]
  onClear: () => void
}

export function HistoryTab({ entries, onClear }: Props) {
  const [open, setOpen] = useState<string | null>(null)
  if (!entries.length) {
    return <EmptyState size="sm" variant="log" title="Вопросов пока не было">Здесь появятся ответы локальной модели с проверкой верности — по этому проекту.</EmptyState>
  }
  return (
    <div className="mt-history">
      <div className="mt-row">
        <IconButton icon="book" onClick={() => downloadText(exportMarkdown(entries), 'mentat-history.md')} title="Сохранить историю в .md">Экспорт .md</IconButton>
        <IconButton icon="close" variant="ghost" onClick={onClear} title="Очистить историю этого проекта на этой машине">Очистить</IconButton>
      </div>
      <ol className="mt-hlist">
        {entries.map((e) => (
          <li key={e.id} className="mt-hitem">
            <button type="button" className="mt-hitem__q" aria-expanded={open === e.id} onClick={() => setOpen(open === e.id ? null : e.id)}>
              <span>{e.question}</span>
              <span className="mt-hitem__meta">
                {dateTime(e.at)} · <span className="mono">{e.asked}</span> · {e.model}
                <Chip size="sm" tone={e.report.pass ? 'good' : 'warn'}>{e.report.pass ? 'сверено' : 'есть расхождения'}</Chip>
              </span>
            </button>
            {open === e.id && (
              <div className="mt-hitem__body">
                <AnswerView report={e.report} titles={pick(e, 'title')} anchors={pick(e, 'mapNode')} />
                <div className="mt-row">
                  <IconButton icon="check" size="sm" onClick={() => { void copyText(e.answer) }} title="Скопировать текст ответа">Копировать ответ</IconButton>
                  <span className="mt-muted mono">{e.promptVersion}</span>
                </div>
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  )
}
