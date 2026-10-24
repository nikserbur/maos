/**
 * «Показать промпт»: ровно те сообщения, что уйдут модели (system → примеры → задание + контекст + вопрос),
 * их версия и размер, и узлы контекста с расстоянием и статусом паспорта. Главный способ проверить
 * промпты до подключения модели: скопировать и прогнать вручную.
 */
import { useState } from 'react'
import { num } from '../../explain/format'
import { IconButton } from '../../ui/kit'
import type { MentatContext } from './context'
import { copyText, downloadText } from './exportText'
import { renderPrompt, type BuiltPrompt } from './prompts'

interface Props {
  prompt: BuiltPrompt
  context: MentatContext
}

export function PromptTab({ prompt, context }: Props) {
  const [copied, setCopied] = useState<boolean | null>(null)
  const text = renderPrompt(prompt)
  const copy = async () => setCopied(await copyText(text))
  const t = context.truncated
  return (
    <div className="mt-prompt">
      <dl className="mt-facts">
        <div><dt>Версия</dt><dd className="mono">{prompt.version}</dd></div>
        <div><dt>Размер</dt><dd>≈ {num(prompt.tokens, 0)} токенов · сообщений {num(prompt.messages.length, 0)}</dd></div>
        <div><dt>Контекст</dt><dd>узлов {num(t.kept, 0)}{t.dropped ? ` · не вошло ${num(t.dropped, 0)}` : ''} · рёбер {num(context.edges.length, 0)} · ≈ {num(t.usedTokens, 0)} из {num(t.budgetTokens, 0)} токенов</dd></div>
      </dl>
      <div className="mt-row">
        <IconButton icon="check" onClick={() => { void copy() }} title="Скопировать весь запрос">{copied ? 'Скопировано' : 'Копировать'}</IconButton>
        <IconButton icon="book" variant="ghost" onClick={() => downloadText(text, `mentat-${prompt.templateId}.md`)} title="Сохранить запрос в .md">Сохранить .md</IconButton>
        {copied === false && <span className="mt-muted">Буфер обмена недоступен — выделите текст ниже.</span>}
      </div>

      <details className="mt-nodes">
        <summary>Узлы контекста ({num(context.nodes.length, 0)})</summary>
        <ul>
          {context.nodes.map((n) => (
            <li key={n.id}>
              <span className="mt-nodes__d mono">d{n.distance}</span>
              <a className="mono" href={`#/map/${encodeURIComponent(n.mapNode)}`}>{n.id}</a>
              {n.status && <span className="mt-nodes__s">{n.status}</span>}
              {n.values?.length ? <span className="mt-nodes__v">{n.values.slice(0, 3).map((v) => v.text).join(' · ')}{n.values.length > 3 ? ' …' : ''}</span> : null}
            </li>
          ))}
        </ul>
      </details>

      <pre className="mt-pre" tabIndex={0} aria-label="Полный текст запроса к модели">{text}</pre>
    </div>
  )
}
