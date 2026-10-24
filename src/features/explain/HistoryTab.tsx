/**
 * История вопросов проекта (X2 P-130): ответы модели с вердиктом проверки верности и постоянной меткой
 * «MENTAT · ИИ · модель · локально», остановленные запросы — «остановлено»; раскрыть, копировать,
 * экспорт в Markdown, очистить (с подтверждением: что исчезнет). Пустая история — честное пустое состояние.
 */
import { useState } from 'react'
import { countText, dateTime } from '../../explain/format'
import { ConfirmDialog } from '../../ui/ConfirmDialog'
import { Chip, EmptyState, IconButton } from '../../ui/kit'
import { getNode } from '../method-map/registry'
import { AnswerView } from './AnswerView'
import { aiLabel } from './AskTab'
import { copyText, downloadText } from './exportText'
import { exportMarkdown, type HistoryEntry } from './llm/history'

const pick = (e: HistoryEntry, k: 'title' | 'mapNode'): Record<string, string> =>
  Object.fromEntries(Object.entries(e.cited ?? {}).map(([id, v]) => [id, v[k]]))

interface Props {
  entries: readonly HistoryEntry[]
  onClear: () => void
}

function Verdict({ e }: { e: HistoryEntry }) {
  if (e.outcome === 'stopped') return <Chip size="sm" tone="idle">остановлено</Chip>
  return <Chip size="sm" tone={e.report.pass ? 'good' : 'warn'}>{e.report.pass ? 'сверено' : 'есть расхождения'}</Chip>
}

export function HistoryTab({ entries, onClear }: Props) {
  const [open, setOpen] = useState<string | null>(null)
  const [confirm, setConfirm] = useState(false)
  if (!entries.length) {
    return <EmptyState size="sm" variant="log" title="Вопросов пока не было">Здесь появятся ответы локальной модели с проверкой верности — по этому проекту.</EmptyState>
  }
  return (
    <div className="mt-history">
      <div className="mt-row">
        <IconButton icon="book" onClick={() => downloadText(exportMarkdown(entries), 'mentat-history.md')} title="Сохранить историю в .md">Экспорт .md</IconButton>
        <button type="button" className="btn btn--ghost btn--sm mt-row__end" onClick={() => setConfirm(true)}>Очистить историю…</button>
      </div>
      <ol className="mt-hlist">
        {entries.map((e) => (
          <li key={e.id} className="mt-hitem">
            <button type="button" className="mt-hitem__q" aria-expanded={open === e.id} onClick={() => setOpen(open === e.id ? null : e.id)}>
              <span>{e.question}</span>
              <span className="mt-hitem__meta">
                {dateTime(e.at)} · {getNode(e.asked)?.title ?? e.cited?.[e.asked]?.title ?? 'узел графа'} · {aiLabel(e.model)}
                <Verdict e={e} />
              </span>
            </button>
            {open === e.id && (
              <div className="mt-hitem__body">
                {e.outcome === 'stopped'
                  ? <p className="mt-muted">Запрос остановлен пользователем — ответа нет.</p>
                  : <AnswerView report={e.report} titles={pick(e, 'title')} anchors={pick(e, 'mapNode')} />}
                <div className="mt-row">
                  {e.outcome !== 'stopped' && <IconButton icon="check" size="sm" onClick={() => { void copyText(e.answer) }} title="Скопировать текст ответа">Копировать ответ</IconButton>}
                  <span className="mt-muted mono">{e.promptVersion}</span>
                </div>
              </div>
            )}
          </li>
        ))}
      </ol>
      {confirm && (
        <ConfirmDialog title="Очистить историю MENTAT?" objectName="История вопросов этого проекта"
          consequence={`Исчезнут ${countText(entries.length, ['запись', 'записи', 'записей'])} на этой машине; данные проекта и расчёты не меняются. Сначала можно сохранить «Экспорт .md».`}
          confirmLabel="Очистить" danger onCancel={() => setConfirm(false)} onConfirm={() => { onClear(); setConfirm(false) }} />
      )}
    </div>
  )
}
