/**
 * Панель MENTAT (UX-V2 §7 G4, блок [8]; METHODOLOGY-V2 §9; X2 P-130): вопрос → контекст графа расчёта →
 * промпт → локальная модель (POST /api/mentat/ask) → проверка верности по узлам → ответ со ссылками на карту.
 * Модель подключает владелец; пока её нет, ответов нет и они не имитируются — «Показать промпт» даёт
 * точный запрос. Запрос можно остановить (AbortController отменяет fetch). Esc закрывает панель через
 * стек слоёв оболочки (AppShell регистрирует слой «mentat») — своего слушателя на window у панели нет.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../../shell/icons'
import { overlayActions, useOverlays } from '../../shell/overlays'
import { countText } from '../../explain/format'
import { Chip, TabPanel, Tabs } from '../../ui/kit'
import { getNode } from '../method-map/registry'
import { AskTab, type AnswerState, type AskPhase } from './AskTab'
import { buildContext } from './context'
import { HistoryTab } from './HistoryTab'
import { EMPTY_REPORT } from './llm/history'
import { DEFAULT_SETTINGS } from './llm/settings'
import { isAborted, isNotConnected, mentatApi } from './llm/mentatApi'
import { PromptTab } from './PromptTab'
import { askedNodeFor, buildPrompt, getTemplate, missingNeeds, splitTemplates, templateForFocus } from './prompts'
import { SettingsTab } from './SettingsTab'
import { useMentatHistory, useMentatSources, useMentatStatus } from './useMentat'
import { verifyAnswer } from './verify'
import './mentat.css'

type Tab = 'ask' | 'prompt' | 'history' | 'settings'

interface Props {
  screenId: string
  onClose: () => void
}

/** Секундомер ожидания ответа: тикает, пока `on`. */
function useElapsed(on: boolean): number {
  const [s, setS] = useState(0)
  useEffect(() => {
    if (!on) return undefined
    setS(0)
    const started = Date.now()
    const t = window.setInterval(() => setS(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => window.clearInterval(t)
  }, [on])
  return s
}

const QUESTION_FORMS = ['вопрос', 'вопроса', 'вопросов'] as const

export function MentatPanel({ screenId, onClose }: Props) {
  const { mentatFocus: focus } = useOverlays()
  const { own, more } = useMemo(() => splitTemplates(screenId), [screenId])
  const [tab, setTab] = useState<Tab>('ask')
  const [templateId, setTemplateId] = useState(() => (focus ? templateForFocus(focus, getNode(focus)?.kind) : (own[0] ?? more[0]).id))
  const [question, setQuestion] = useState('')
  const [compareRunId, setCompareRunId] = useState('')
  const [phase, setPhase] = useState<AskPhase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [answer, setAnswer] = useState<AnswerState | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const elapsed = useElapsed(phase === 'asking')
  const st = useMentatStatus()
  const history = useMentatHistory()
  const { sources, available, runs } = useMentatSources(compareRunId)

  // Новый узел с карты / «i» → шаблон под него, вкладка «Вопрос».
  useEffect(() => {
    if (!focus) return
    setTemplateId(templateForFocus(focus, getNode(focus)?.kind))
    setTab('ask'); setPhase('idle'); setAnswer(null)
  }, [focus])

  // Закрытие панели или уход со страницы — незавершённый запрос отменяется.
  useEffect(() => () => abortRef.current?.abort(), [])

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
  const entryBase = () => ({
    id: `${Date.now()}-${template.id}`, at: new Date().toISOString(), templateId: template.id, question: prompt.question,
    asked, promptVersion: prompt.version,
  })

  const ask = async () => {
    // Модель заведомо не задана — запрос не нужен: честное пустое состояние сразу.
    if (st.status && !st.status.configured) { setPhase('not_connected'); setAnswer(null); return }
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setPhase('asking'); setError(null); setAnswer(null)
    try {
      const r = await mentatApi.ask({
        messages: prompt.messages, template_id: template.id, prompt_version: prompt.version, asked,
        context: { nodes: context.nodes.length, tokens: context.truncated.usedTokens },
      }, ctrl.signal)
      const report = verifyAnswer(r.text, context)
      setAnswer({ report, model: r.model, ms: r.ms })
      setPhase('answered')
      history.add({
        ...entryBase(), model: r.model, answer: r.text, report, outcome: 'answered',
        cited: Object.fromEntries(report.claims.flatMap((c) => c.citations)
          .filter((id) => titles[id]).map((id) => [id, { title: titles[id], mapNode: anchors[id] }])),
      })
    } catch (e) {
      if (isAborted(e)) {
        setPhase('stopped')
        history.add({ ...entryBase(), model: st.status?.model ?? '', answer: '', report: EMPTY_REPORT, outcome: 'stopped' })
        return
      }
      if (isNotConnected(e)) { setPhase('not_connected'); return }
      setPhase('error')
      setError(e instanceof Error ? e.message : 'Сбой запроса к MENTAT-API')
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null
    }
  }
  const stop = () => abortRef.current?.abort()

  const connected = st.status ? st.status.configured : null
  const tabs = [
    { id: 'ask' as const, label: 'Вопрос' },
    { id: 'prompt' as const, label: 'Промпт' },
    { id: 'history' as const, label: 'История', count: history.entries.length,
      countLabel: `${countText(history.entries.length, QUESTION_FORMS)} в истории` },
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
            {connected ? `${st.status?.model} · локально` : 'модель не подключена'}
          </Chip>
          <button type="button" className="btn btn--ghost btn--icon" onClick={onClose} aria-label="Закрыть панель MENTAT" title="Закрыть (Esc)">
            <Icon name="close" size={16} />
          </button>
        </div>
      </header>

      <Tabs<Tab> items={tabs} value={tab} onChange={setTab} label="Разделы MENTAT" size="panel" idBase="mt" />

      <TabPanel idBase="mt" id={tab} className="mt-body">
        {tab === 'ask' && (
          <AskTab own={own} more={more} template={template} onTemplate={pickTemplate} asked={asked} focus={focus}
            onClearFocus={overlayActions.clearMentatFocus} question={question} placeholder={defaultQuestion} onQuestion={setQuestion}
            missing={missingNeeds(template, available)} runs={runs} compareRunId={compareRunId} onCompare={setCompareRunId}
            context={context} connected={connected} phase={phase} elapsed={elapsed} error={error} answer={answer}
            titles={titles} anchors={anchors} onAsk={() => { void ask() }} onStop={stop}
            onShowPrompt={() => setTab('prompt')} onSettings={() => setTab('settings')} />
        )}
        {tab === 'prompt' && <PromptTab prompt={prompt} context={context} />}
        {tab === 'history' && <HistoryTab entries={history.entries} onClear={history.clear} />}
        {tab === 'settings' && <SettingsTab st={st} />}
      </TabPanel>
    </aside>
  )
}
