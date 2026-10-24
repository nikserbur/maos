/**
 * Верх «Мониторинга» (X2 «сначала ответ»; владелец: «невзрачно», «“Не хватает данных 1” ничего не
 * объясняет»):
 *  - `StatusHeadline` — деловой статус словами («▲ Внимание: сырьё дорожает до +44 % · ещё 2») отдельно
 *    от полноты данных («○ Не рассчитано: касса → Рассчитать»), чипы «прогноз / ◆ что если», «демо-данные»
 *    и «■ N параметров вручную», одна фраза ответа, строка надёжности, основа расчёта (на узком экране —
 *    свёрнута в «Основа расчёта ▾»), «Показать прогноз», если показан не прогноз;
 *  - `KpiRow` — четыре плитки в порядке конвейера: цены сбыта, закупочные цены, заказы в срок, кассовый
 *    разрыв. Состояние плитки — только отклонение от порога или «план устарел»; происхождение данных
 *    («демо») — один раз в главной карточке. Не рассчитано — «—» и маленькая кнопка, а не ноль.
 */
import { useState, type ReactNode } from 'react'
import { freqText, num, pct } from '../../explain/format'
import { Sparkline } from '../../ui/charts'
import { InfoTip } from '../../ui/InfoTip'
import { KpiTile, Skeleton } from '../../ui/kit'
import { OVERLOAD } from '../plan/verdict'
import { runHref } from '../plan/planNav'
import { SEVERITY, moveDigits, moveText, signedRangeText, type MonitorStatus, type PriceMove } from './monitorModel'
import { CASH_GAP_CRIT, CASH_GAP_WARN, MOVE_ALERT, OTD_CRIT, OTD_WARN, planLabel, type PlanFacts } from './monitorSignals'
import './monitor.css'

interface StatusProps {
  status: MonitorStatus | null
  /** Фраза ответа; null — считаем (скелет). */
  answer: string | null
  trust: string | null
  chips?: ReactNode
  /** Чип полноты данных («○ Не рассчитано: касса → Рассчитать»). */
  missing?: ReactNode
  basis?: ReactNode
  /** Действие под ответом: «Показать прогноз (обучено на истории)». */
  action?: ReactNode
}

function StatusPill({ status }: { status: MonitorStatus }) {
  const sev = SEVERITY[status.level]
  return (
    <span className="mon-status__pill" role="status">
      <span className="mon-status__glyph" aria-hidden="true">{sev.glyph}</span>
      <span className="mon-status__word">{status.title}{status.lead ? ':' : ''}</span>
      {status.lead && <span className="mon-status__lead">{status.lead}</span>}
      {status.more > 0 && <span className="mon-status__more">· ещё {num(status.more, 0)}</span>}
      {status.level === 'ok' && status.info > 0 && <span className="mon-status__more">· {num(status.info, 0)} к сведению</span>}
    </span>
  )
}

export function StatusHeadline({ status, answer, trust, chips, missing, basis, action }: StatusProps) {
  const [basisOpen, setBasisOpen] = useState(false)
  return (
    <section className={`mon-status mon-status--${status?.level ?? 'pending'}`} aria-labelledby="mon-status-answer" aria-busy={!status || undefined}>
      <div className="mon-status__row">
        {status ? <StatusPill status={status} /> : <Skeleton h={28} w={220} radius="var(--radius-pill)" />}
        {missing}
        {chips}
        <span className="mon-status__info"><InfoTip id="forecast.fan" /></span>
      </div>
      {answer ? <p className="mon-status__answer" id="mon-status-answer">{answer}</p> : <Skeleton h={28} w="72%" />}
      {trust && <p className="mon-status__trust">{trust}</p>}
      {action && <div className="mon-status__action">{action}</div>}
      {basis && (
        <div className="mon-status__basiswrap">
          <button type="button" className="mon-status__basistoggle" aria-expanded={basisOpen} onClick={() => setBasisOpen((v) => !v)}>
            Основа расчёта <span aria-hidden="true">{basisOpen ? '▴' : '▾'}</span>
          </button>
          <div className={`mon-status__basis${basisOpen ? '' : ' is-collapsed'}`}>{basis}</div>
        </div>
      )}
    </section>
  )
}

/* ── Плитки ───────────────────────────────────────────────────────────────── */

type TileState = { glyph: 'glyph-setup' | 'glyph-down'; word: string }

/** Отклонение цены от порога сигнала: сырьё дорожает или сбыт дешевеет на MOVE_ALERT и больше. */
function priceState(role: 'product' | 'raw', median: number): TileState | undefined {
  if (role === 'raw' && median >= MOVE_ALERT) return { glyph: 'glyph-setup', word: `выше порога ${pct(MOVE_ALERT, 0)}` }
  if (role === 'product' && median <= -MOVE_ALERT) return { glyph: 'glyph-setup', word: `падение больше ${pct(MOVE_ALERT, 0)}` }
  return undefined
}

interface PriceTileProps { label: string; role: 'product' | 'raw'; move: PriceMove | null; loading: boolean; failed: boolean }

function PriceTile({ label, role, move, loading, failed }: PriceTileProps) {
  if (!move) {
    return (
      <KpiTile metric="forecast.fan" label={label} value="—" className="mon-kpi--empty">
        {loading ? <Skeleton h={14} w="70%" /> : <span className="mon-kpi__note">{failed ? 'прогноз не рассчитан' : 'рядов этой роли нет'}</span>}
      </KpiTile>
    )
  }
  return (
    <KpiTile metric="forecast.fan" label={label} value={moveText(move.median)} state={priceState(role, move.median)}
      interval={<>у типичной позиции: <span className="mon-kpi__range num">{signedRangeText(move.lo, move.hi, moveDigits(move.median))}</span></>}>
      <span className="mon-kpi__spark" title="Медиана по позициям, «сейчас» = 100"><Sparkline points={move.index} width={132} height={28} /></span>
    </KpiTile>
  )
}

function otdState(otd: number, stale: string | null): TileState | undefined {
  if (otd < OTD_CRIT) return { glyph: 'glyph-down', word: `ниже ${pct(OTD_CRIT, 0)}` }
  if (otd < OTD_WARN) return { glyph: 'glyph-setup', word: `ниже ${pct(OTD_WARN, 0)}` }
  return stale ? { glyph: 'glyph-setup', word: 'план устарел' } : undefined
}

function OtdTile({ plan }: { plan: PlanFacts }) {
  if (plan.otd === null) {
    return (
      <KpiTile metric="plan.otd" label="Заказы в срок" value="—" className="mon-kpi--empty">
        <a className="btn btn--sm mon-kpi__act" href="#/plan/new">Построить план</a>
      </KpiTile>
    )
  }
  const bn = plan.bottleneck
  // Перегрузка — только сигналом «Перегрузка участка»: плитка остаётся короткой.
  const showBn = bn && bn.load < OVERLOAD
  return (
    <KpiTile metric="plan.otd" label="Заказы в срок" value={pct(plan.otd, 0)} state={otdState(plan.otd, plan.stale)} interval={planLabel(plan)}>
      {showBn && (
        <span className="mon-kpi__note">
          Самый загруженный участок — <span className="num">{pct(bn.load, 0)}</span>
          <span className="mon-kpi__sub">{bn.name}</span>
        </span>
      )}
    </KpiTile>
  )
}

function cashState(p: number): TileState | undefined {
  if (p >= CASH_GAP_CRIT) return { glyph: 'glyph-down', word: 'требует решения' }
  if (p >= CASH_GAP_WARN) return { glyph: 'glyph-setup', word: `от ${num(Math.round(CASH_GAP_WARN * 100), 0)} из 100 — внимание` }
  return undefined
}

function CashTile({ plan }: { plan: PlanFacts }) {
  const hasPlan = Boolean(plan.planKey || plan.otd !== null)
  if (!plan.cashGap) {
    return (
      <KpiTile metric="cash.p_breach" label="Кассовый разрыв" value="—" className="mon-kpi--empty">
        {hasPlan && plan.planKey
          ? <a className="btn btn--sm mon-kpi__act" href={runHref(plan.planKey, 'cash')}>Рассчитать кассу</a>
          : <span className="mon-kpi__note">касса считается по построенному плану</span>}
      </KpiTile>
    )
  }
  const { p, ci } = plan.cashGap
  return (
    <KpiTile metric="cash.p_breach" label="Кассовый разрыв" value={freqText(p)} state={cashState(p)}
      values={{ p, ci_lo: ci?.[0], ci_hi: ci?.[1], warn: CASH_GAP_WARN, bad: CASH_GAP_CRIT }}
      interval={<>сценариев · {planLabel(plan)}{ci ? ` · точность оценки: ${num(Math.round(ci[0] * 100), 0)}–${num(Math.round(ci[1] * 100), 0)} из 100` : ''}</>} />
  )
}

interface KpiRowProps {
  goods: PriceMove | null
  raw: PriceMove | null
  /** «к марту 2027». */
  by: string
  plan: PlanFacts
  loading: boolean
  failed: boolean
}

export function KpiRow({ goods, raw, by, plan, loading, failed }: KpiRowProps) {
  return (
    <div className="mon-kpis" role="group" aria-label="Главные показатели">
      <PriceTile label={`Цены сбыта ${by}`} role="product" move={goods} loading={loading} failed={failed} />
      <PriceTile label={`Закупочные цены ${by}`} role="raw" move={raw} loading={loading} failed={failed} />
      <OtdTile plan={plan} />
      <CashTile plan={plan} />
    </div>
  )
}
