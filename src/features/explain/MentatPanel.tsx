/**
 * Панель MENTAT (UX-V2 §7 G4, блок [8]; METHODOLOGY-V2 §9): вопрос → контекст графа расчёта → промпт →
 * локальная модель (через POST /api/mentat/ask) → проверка верности ответа по узлам → ответ со ссылками на
 * карту. Модель подключает владелец; пока её нет, ответов нет и они не имитируются — «Показать промпт»
 * даёт точный запрос. Открывается из верхней панели, палитры, Cmd/Ctrl+J и «Спросить MENTAT» узла/«i».
 */
import { useEffect, useMemo, useState } from 'react'
import { Icon } from '../../shell/icons'
import { overlayActions, useOverlays } from '../../shell/overlays'
import { Chip, Segmented } from '../../ui/kit'
import { getNode } from '../method-map/registry'
import { AskTab, type AnswerState, type AskPhase } from './AskTab'
import { buildContext } from './context'
import { HistoryTab } from './HistoryTab'
import { DEFAULT_SETTINGS } from './llm/settings'
import { isNotConnected, mentatApi } from './llm/mentatApi'
import { PromptTab } from './PromptTab'
import { askedNodeFor, buildPrompt, getTemplate, missingNeeds, templateForFocus, templatesFor } from './prompts'
import { SettingsTab } from './SettingsTab'
import { useMentatHistory, useMentatSources, useMentatStatus } from './useMentat'
import { verifyAnswer } from './verify'
import './mentat.css'

type Tab = 'ask' | 'prompt' | 'history' | 'settings'

interface Props {
  screenId: string
  onClose: () => void
}

export function MentatPanel({ screenId, onClose }: Props) {
  const { mentatFocus: focus } = useOverlays()
  const templates = useMemo(() => templatesFor(screenId), [screenId])
  const [tab, setTab] = useState<Tab>('ask')
  const [templateId, setTemplateId] = useState(() => (focus ? templateForFocus(focus, getNode(focus)?.kind) : templates[0].id))
  const [question, setQuestion] = useState('')
  const [compareRunId, setCompareRunId] = useState('')
  const [phase, setPhase] = useState<AskPhase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [answer, setAnswer] = useState<AnswerState | null>(null)
  const st = useMentatStatus()
  const history = useMentatHistory()
  const { sources, available, runs } = useMentatSources(compareRunId)

  // Новый узел с карты / «i» → шаблон под него, вкладка «Вопрос».
  useEffect(() => {
    if (!focus) return
    setTemplateId(templateForFocus(focus, getNode(focus)?.kind))
    setTab('ask'); setPhase('idle'); setAnswer(null)
  }, [focus])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const template = getTemplate(templateId)
  const asked = askedNodeFor(template, focus)
  const settings = st.status?.settings ?? DEFAULT_SETTINGS
  const context = useMemo(() => buildContext({ ...sources, asked, budgetTokens: settings.context_tokens }), [sources, asked, settings.context_tokens])
  const askedTitle = context.nodes.find((n) => n.id === asked)?.title ?? getNode(asked)?.title ?? asked
  const defaultQuestion = template.question || `Почему у узла «${askedTitle}» такое значение и от чего оно зависит?`
  const effectiveQuestion = question.trim() || defaultQuestion
  const prompt = useMemo(() => buildPrompt({ template, question: effectiveQuestion, context, withExamples: settings.with_examples }), [template, effectiveQuestion, context, settings.with_examples])
  const titles = useMemo(() => Object.fromEntries(context.nodes.map((n) => [n.id, n.title])), [context])
  const anchors = useMemo(() => Object.fromEntries(context.nodes.map((n) => [n.id, n.mapNode])), [context])

  const pickTemplate = (id: string) => { setTemplateId(id); setQuestion(''); setPhase('idle'); setAnswer(null) }

  const ask = async () => {
    // Модель заведомо не задана — запрос не нужен: честное пустое состояние сразу.
    if (st.status && !st.status.configured) { setPhase('not_connected'); setAnswer(null); return }
    setPhase('asking'); setError(null); setAnswer(null)
    try {
      const r = await mentatApi.ask({
        messages: prompt.messages, template_id: template.id, prompt_version: prompt.version, asked,
        context: { nodes: context.nodes.length, tokens: context.truncated.usedTokens },
      })
      const report = verifyAnswer(r.text, context)
      setAnswer({ report, model: r.model, ms: r.ms })
      setPhase('answered')
      history.add({
        id: `${Date.now()}-${template.id}`, at: new Date().toISOString(), templateId: template.id, question: prompt.question,
        asked, promptVersion: prompt.version, model: r.model, answer: r.text, report,
        cited: Object.fromEntries(report.claims.flatMap((c) => c.citations)
          .filter((id) => titles[id]).map((id) => [id, { title: titles[id], mapNode: anchors[id] }])),
      })
    } catch (e) {
      if (isNotConnected(e)) { setPhase('not_connected'); return }
      setPhase('error')
      setError(e instanceof Error ? e.message : 'Сбой запроса к MENTAT-API')
    }
  }

  const connected = st.status?.configured
  const tabs = [
    { id: 'ask' as const, label: 'Вопрос' },
    { id: 'prompt' as const, label: 'Промпт' },
    { id: 'history' as const, label: 'История', count: history.entries.length || undefined },
    { id: 'settings' as const, label: 'Подключение' },
  ]

  return (
    <aside className="mt" aria-labelledby="mt-title">
      <header className="mt-head">
        <div>
          <p className="text-caps mt-eyebrow">[8] LLM · объяснение по графу</p>
          <h2 className="mt-title" id="mt-title">MENTAT · почему так</h2>
        </div>
        <div className="mt-head__right">
          <Chip size="sm" tone={connected ? 'good' : 'idle'} title={connected ? `${st.status?.model} · ${st.status?.base_url}` : 'Локальная модель не подключена'}>
            {connected ? st.status?.model : 'модель не подключена'}
          </Chip>
          <button type="button" className="btn btn--ghost btn--icon" onClick={onClose} aria-label="Закрыть панель MENTAT" title="Закрыть (Esc)">
            <Icon name="close" size={16} />
          </button>
        </div>
      </header>

      <Segmented<Tab> options={tabs} value={tab} onChange={setTab} label="Разделы MENTAT" kind="tab" size="sm" idBase="mt" />

      <div className="mt-body" role="tabpanel" id={`mt-panel-${tab}`} aria-labelledby={`mt-tab-${tab}`}>
        {tab === 'ask' && (
          <AskTab templates={templates} template={template} onTemplate={pickTemplate} asked={asked} focus={focus}
            onClearFocus={overlayActions.clearMentatFocus} question={question} placeholder={defaultQuestion} onQuestion={setQuestion}
            missing={missingNeeds(template, available)} runs={runs} compareRunId={compareRunId} onCompare={setCompareRunId}
            phase={phase} error={error} answer={answer} titles={titles} anchors={anchors} onAsk={() => { void ask() }}
            onShowPrompt={() => setTab('prompt')} onSettings={() => setTab('settings')} />
        )}
        {tab === 'prompt' && <PromptTab prompt={prompt} context={context} />}
        {tab === 'history' && <HistoryTab entries={history.entries} onClear={history.clear} />}
        {tab === 'settings' && <SettingsTab st={st} />}
      </div>
    </aside>
  )
}
