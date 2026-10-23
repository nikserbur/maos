/**
 * Блок правила «RL» рядом с карточкой ГА (UX-V2 §7 G4: «та же карточка, что GaImproverCard»):
 * событийный прогон политики L0 по средним длительностям (`result.rl`) против детерминированных
 * правил прогона, доля ожиданий WAIT и хэш политики. Ни слова о «выигрыше» без ДИ: статистическое
 * сравнение с ДИ — только на стенде V5 (гейт §7.4), ссылка на «Агенты».
 */
import type { RlEval, SchedRule } from '../../lib/api'
import { hours, num, pct } from '../../explain/format'
import { BarList, type BarRow } from '../../ui/charts'
import { Chip } from '../../ui/kit'
import { shortSha } from '../agents/rlStatusStore'

export function RlEvalCard({ rl, rules }: { rl: RlEval; rules: readonly SchedRule[] }) {
  const ranked = [...rules].sort((a, b) => a.makespan - b.makespan)
  const best = ranked[0]
  const waitShare = rl.n_decisions > 0 ? rl.n_wait / rl.n_decisions : 0
  const rows: BarRow[] = [
    { key: 'rl', label: 'RL · политика L0', value: rl.makespan_h, marked: true, secondary: 'событийно, по средним' },
    ...ranked.slice(0, 4).map((r) => ({ key: r.rule, label: r.rule, value: r.makespan, secondary: r.chosen ? '● выбрано в прогоне' : 'Монте-Карло, E' })),
  ]
  return (
    <section className="pl-ga pl-ga--kept" aria-labelledby="pl-rl-title">
      <div className="pl-ga__main">
        <div className="pl-ga__eyebrow text-caps" id="pl-rl-title">Правило «RL» · агент L0 · политика {shortSha(rl.policy_sha256)}</div>
        <p className="pl-ga__headline">
          <span className="pl-ga__big num">{hours(rl.makespan_h, 0)}</span>
          <span>Cmax событийного прогона политики по средним длительностям{best ? <> · лучшее правило {best.rule}: E[Cmax] {hours(best.makespan, 0)}</> : null}</span>
        </p>
        <div className="pl-bn__chips">
          <Chip>{num(rl.n_decisions, 0)} решений · WAIT {pct(waitShare, 0)}</Chip>
          <Chip tone={rl.tardiness_h > 0 ? 'warn' : 'good'}>просрочка {hours(rl.tardiness_h, 0)}</Chip>
          <Chip tone="idle">без ДИ: сравнение по средним, не по сценариям</Chip>
        </div>
        <p className="pl-note">
          Статистическое сравнение с правилами и ГА на одних сценариях (IQM, бутстреп-ДИ, Уилкоксон) — на стенде V5;
          по гейту §7.4 чемпион — лучшее правило. <a className="mv-link" href="#/agents">Таблицы V4/V5 и гейт — «Агенты» →</a>
        </p>
      </div>
      <div className="pl-ga__chart">
        <BarList rows={rows} fmt={(v) => hours(v, 0)} compact valueHeader="Cmax" ariaLabel={`Cmax: RL ${hours(rl.makespan_h, 0)} против правил прогона`} />
      </div>
    </section>
  )
}
