/**
 * Экран «Агенты» `#/agents/<вкладка>` — блок [6], четыре вкладки в адресе (F5 сохраняет вид):
 * «Вердикт» — одна фраза, три плитки, лесной график претендентов и реестр правил, найденных RL;
 * «Доказательства» — RL против правил (V5/A3/A4) или расписание против BKS (V4/A2), выбор — в адресе;
 * «Полномочия» — что действует сейчас, α только для чтения, единая таблица видов ходов, лимиты;
 * «Как устроен» — свёрнутое пояснение L0/L2, «Методика», игры одной строкой.
 */
import { useEffect } from 'react'
import { num } from '../../explain/format'
import { BlockChips } from '../../ui/BlockChip'
import { Chip, ScreenHeader, Section, Tabs } from '../../ui/kit'
import { ErrorBoundary } from '../../shell/ErrorBoundary'
import { setCrumbTitle } from '../../shell/crumbs'
import { buildHash, navigateTo, useHashParams, useHashRoute } from '../../shell/router'
import { usePlanStore } from '../plan/planStore'
import { V5, snapDay } from './benchData'
import { GuardrailsCard } from './GuardrailsCard'
import { LevelsCard } from './LevelsCard'
import { GamesStrip } from './PriceOfAnarchy'
import { RlEvidence } from './RlEvidence'
import { RlRulesLedger } from './RlRulesLedger'
import { RlStatusCard, VerdictForest } from './RlStatusCard'
import { A4S } from './rlLedger'
import { V4Bench } from './V4Bench'
import { AGENTS_TABS, agentsTab } from './tabs'
import './agents.css'

export function AgentsScreen() {
  const { anchor } = useHashRoute()
  const tab = agentsTab(anchor)
  const found = AGENTS_TABS.find((t) => t.id === tab)?.label
  const label = typeof found === 'string' ? found : ''
  useEffect(() => {
    setCrumbTitle('agents', tab, label)
    return () => setCrumbTitle('agents', tab, null)
  }, [tab, label])

  return (
    <div className="agents">
      <ScreenHeader
        eyebrow="Решения · блок [6]"
        title="Агенты"
        blocks={['agents']}
        provenance={<Chip size="sm" title={`${V5.source} · ${A4S.source}`}>стенд rl/ · {num(V5.instances.length, 0)} + {num(A4S.a4.n_instances, 0)} экземпляров · снимок {snapDay(A4S.snapshot_date)}</Chip>}
        subtitle="Агент предлагает — человек утверждает. Выигрыш засчитывается только с ДИ на отложенных сценариях."
      />
      <Tabs label="Разделы экрана «Агенты»" value={tab} items={AGENTS_TABS} onChange={(id) => navigateTo('agents', id)} />
      <div className="ag-panel" role="region" aria-label={label}>
        <ErrorBoundary key={tab} variant="inline" label={`Агенты · ${label}`}>
          {tab === 'verdict' && <VerdictTab />}
          {tab === 'evidence' && <EvidenceTab />}
          {tab === 'guardrails' && <GuardrailsTab />}
          {tab === 'how' && <HowTab />}
        </ErrorBoundary>
      </div>
    </div>
  )
}

function VerdictTab() {
  return (
    <>
      <RlStatusCard />
      <VerdictForest />
      <RlRulesLedger />
    </>
  )
}

type EvidenceView = 'rl' | 'v4'

/** Подразделы «Доказательств» — разные таблицы и источники, поэтому вкладки (адрес `?view=`), а не переключатель. */
const EVIDENCE_TABS = [
  { id: 'rl' as const, label: 'RL против правил', href: buildHash('agents', 'evidence') },
  { id: 'v4' as const, label: 'Расписание против эталона (BKS)', href: buildHash('agents', 'evidence', { view: 'v4' }) },
]

function EvidenceTab() {
  const [params, setParams] = useHashParams()
  const view: EvidenceView = params.view === 'v4' ? 'v4' : 'rl'
  return (
    <>
      <Tabs label="Что доказываем" size="panel" value={view}
        onChange={(id) => setParams({ view: id === 'rl' ? null : id, stress: null, vs: null, rows: null, cmax: null })}
        items={EVIDENCE_TABS}
        end={<span className="ag-snap">{view === 'rl' ? 'запуски V5, A3, A4' : 'запуски V4, A2'}</span>} />
      {view === 'rl' ? <RlEvidence /> : (
        <Section id="ag-v4" title="Расписание без неопределённости: правила, генетический алгоритм и CP-SAT против эталона"
          meta="Taillard 15×15, Brandimarte и 12 экземпляров MAOS · эталон детерминированной задачи — точный солвер, не RL">
          <V4Bench />
        </Section>
      )}
    </>
  )
}

function GuardrailsTab() {
  const plan = usePlanStore()
  return <GuardrailsCard nsiAllowed={plan.result?.moves?.guardrails.allowed} />
}

function HowTab() {
  return (
    <Section id="ag-how" title="Как устроен агент"
      meta={<>Читает режимы и сценарии, хвосты длительностей и цен, маски допустимости и цель; пишет ходы в решения <BlockChips blocks={['external', 'distributions', 'internal', 'criteria', 'decisions']} /></>}>
      <LevelsCard />
      <p className="ag-strip">
        <span>Протокол «RL → эвристика», гейт и стенд — подробно, с формулами:</span>
        <a className="ag-link" href="#/methodology/rl">Методика →</a>
      </p>
      <GamesStrip />
    </Section>
  )
}
