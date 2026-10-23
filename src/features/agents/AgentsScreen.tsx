/**
 * Экран «Агенты» `#/agents` (UX-V2 §7 G4, решение владельца §8 п. 6) — блок [6]:
 * 1) вердикт гейта и живой статус политики (GET /api/rl/status) — честно: «RL не прошёл гейт»;
 * 2) доказательства — V5 (отложенные сценарии, стрессы) и V4 (бенчмарки) из снимков стенда;
 * 3) полномочия агента с единым α сценария; 4) два уровня агента и словарь ходов с масками;
 * 5) игры (цена анархии, Штакельберг) — «в плане», формулы из реестра «i», без чисел.
 */
import { usePlanStore } from '../plan/planStore'
import { ScreenHeader, Section, StatusChip } from '../../ui/kit'
import { BlockChips } from '../../ui/BlockChip'
import { V4Table, V5Table } from './BenchTables'
import { GuardrailsCard } from './GuardrailsCard'
import { LevelsCard } from './LevelsCard'
import { PriceOfAnarchy } from './PriceOfAnarchy'
import { RlStatusCard } from './RlStatusCard'
import { rlAvailable, useRlStatus } from './rlStatusStore'
import './agents.css'

export function AgentsScreen() {
  const rl = useRlStatus()
  const plan = usePlanStore()
  const ok = rlAvailable(rl.status)
  const nsiAllowed = plan.result?.moves?.guardrails.allowed
  return (
    <div className="agents">
      <ScreenHeader
        eyebrow="Решения · блок [6] · агенты и игры"
        title="Агенты"
        blocks={['agents']}
        subtitle="Агент предлагает, человек утверждает, обе стороны видят одни и те же сценарии. Выигрыш признаётся только с ДИ на отложенных сценариях."
        actions={<StatusChip tone={ok ? 'running' : rl.load === 'error' ? 'down' : 'idle'}>{ok ? 'RL доступно' : rl.load === 'loading' ? 'проверяем политику…' : 'RL недоступно · чемпион — правило'}</StatusChip>}
      />

      <RlStatusCard />

      <Section id="ag-v5" title="V5 · структурный RL на отложенных сценариях"
        meta={<>IQM разностей по 12 экземплярам, парный бутстреп (B = 2000), Уилкоксон; ΔCVaR — в долях E[Π] базовой линии</>}>
        <V5Table />
      </Section>

      <GuardrailsCard nsiAllowed={nsiAllowed} />

      <Section id="ag-how" title="Как устроен агент"
        meta="Потребляет режимы и сценарии [1], хвосты длительностей и цен [2], маски допустимости [3]; цель — от [5]; пишет ходы обратно в [4]"
        tools={<BlockChips blocks={['external', 'distributions', 'internal', 'criteria', 'decisions']} />}>
        <LevelsCard />
      </Section>

      <Section id="ag-v4" title="V4 · расписание: правила, ГА и CP-SAT против BKS"
        meta="Taillard 15×15, Brandimarte и 12 экземпляров MAOS; эталон для детерминированной задачи — точный солвер, не RL">
        <V4Table />
      </Section>

      <Section id="ag-games" title="Игры" meta="METHODOLOGY-V2 §7.5 · волна V6 не начата — формулы показаны как контракт экрана">
        <PriceOfAnarchy />
      </Section>
    </div>
  )
}
