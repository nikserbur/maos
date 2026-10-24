/**
 * Вердикт экрана «Агенты» за 5 секунд (X2 «ответ сначала»): одна фраза + три плитки рядом со своим
 * риском — чемпион (C*, лучше в 49 из 60), лучший RL против правила (≈ 0 б. п. с ДИ и «лучше в N из
 * 12»), сколько политик опубликовано (критерий гейта); один основной шаг конвейера — «Строить план
 * с чемпионом»; сервер одной строкой с «Подробнее». Вердикт гейта — из `gate_a3` (то же поле, что у
 * MENTAT); без сервера — снимок. Ниже — лесной график претендентов и реестр правил, найденных RL.
 */
import { num } from '../../explain/format'
import { Forest } from '../../ui/charts'
import { ErrorBanner, KpiTile, Skeleton } from '../../ui/kit'
import { V5, bpApprox, bpCi, bpFine, bpNum, gateSummary, isIdle, policyLabel, snapDay, v5Forest, winCount } from './benchData'
import { V4A2, summarizeA2 } from './benchV4'
import { championShares, gateView, pctVci, strictNearZero, type GateView } from './rlLedger'
import { ensureRlStatus, rlAvailable, serverDetails, useRlStatus, type RlStatusState } from './rlStatusStore'

const P_MAX = 0.05
/** Уровень хвоста стенда V5 (CVaR при α = 0,1). */
const ALPHA_V5 = 0.1

function verdictText(ok: boolean, g: GateView): string {
  if (ok) return 'Политика прошла гейт и опубликована — правило «RL» доступно в мастере плана.'
  if (g.pass) return 'Политика прошла гейт, но сервер её не видит — правило «RL» пока недоступно.'
  return 'RL не прошёл строгий гейт — чемпион остаётся эвристикой C*, политика в продукт не опубликована.'
}

export function RlStatusCard() {
  const s = useRlStatus()
  const ok = rlAvailable(s.status)
  const g = gateView(s.status?.gate_a3)
  const v5 = gateSummary(V5)
  const best = v5.best
  const champ = championShares()[0]
  const bks = summarizeA2(V4A2.rows)
  // Публикуется только прошедшая гейт политика; если сервер видит политику — она опубликована.
  const published = ok ? Math.max(1, v5.passed) : v5.passed
  const strictNote = !g.pass && strictNearZero(g)
    ? 'строгий контроль A3: выигрыш RL целиком даёт одно правило — оно уже в продукте'
    : `строгий контроль A3: ${pctVci(g.strictCi)} стоимости портфеля`
  const next = ok
    ? { href: '#/plan/new/objective?rule=rl', text: 'Выбрать «RL» в мастере плана →' }
    : { href: '#/plan/new/objective?rule=auto', text: 'Строить план с чемпионом C* →' }

  return (
    <section className="ag-hero" aria-labelledby="ag-hero-t">
      <p className="ag-hero__eyebrow text-caps">Строгая проверка на отложенных сценариях</p>
      <p className="ag-hero__verdict" id="ag-hero-t">{verdictText(ok, g)}</p>
      <div className="ag-hero__tiles">
        <KpiTile metric="agent.champion" label="Чемпион" value="C*" size="md" values={{ n_cstar: champ?.n, n: champ?.of }}
          interval={champ ? `лучше в ${num(champ.n, 0)} из ${num(champ.of, 0)} экземпляров` : undefined}>
          <p className="ag-tile__note">эвристика + казначейское правило · по валидации; holdout не завершён</p>
        </KpiTile>
        {best && (
          <KpiTile metric="agent.gate_delta" label="Лучший RL против правила" value={bpApprox(best.iqm)} size="md"
            values={{ delta: bpFine(best.iqm, { signed: true }), n: V5.n }}
            interval={`95 %-ДИ ${bpCi(best.ci95)} б. п. · лучше в ${num(winCount(V5, best.win), 0)} из ${num(V5.instances.length, 0)}`}>
            <p className="ag-tile__note">
              {isIdle(V5, best.policy) ? '0 ходов — совпал с правилом «по ближайшему сроку»' : policyLabel(best.policy)} ·{' '}
              <span className="glyph-setup" title={`снимок стенда V5 от ${snapDay(V5.snapshot_date)}`}>снимок устарел — есть A2–A4</span>
            </p>
          </KpiTile>
        )}
        <KpiTile metric="agent.gate_ci" label="Опубликовано политик RL" value={`${num(published, 0)} из ${num(v5.candidates, 0)}`} size="md"
          values={best ? { ci_lo: bpNum(best.ci95[0]), ci_hi: bpNum(best.ci95[1]), p: num(best.p, 2) } : undefined}
          interval={`критерий: весь 95 %-ДИ выше нуля и p < ${num(P_MAX, 2)}`}>
          <p className="ag-tile__note">{strictNote}</p>
        </KpiTile>
      </div>
      <div className="ag-hero__act">
        <a className="btn btn--primary" href={next.href}>{next.text}</a>
        <a className="btn btn--ghost btn--sm" href="#/map/ag.rl">[6] на карте ↗</a>
        <a className="ag-link" href="#/agents/evidence?view=v4">Расписание без неопределённости: эталон — точный солвер, CP-SAT = BKS {num(bks.cpsatAtBks, 0)} из {num(bks.withBks, 0)} →</a>
      </div>
      <ServerLine s={s} />
    </section>
  )
}

/** Сервер одной строкой: «Политика в продукте: не опубликована» + «Подробнее» (среда, SHA, каталог, ответ). */
function ServerLine({ s }: { s: RlStatusState }) {
  const st = s.status
  if (s.load === 'loading' && !st) return <div className="ag-server" aria-busy="true"><Skeleton w="18em" /></div>
  if (s.load === 'error' && !st) {
    return (
      <ErrorBanner tone="setup" title="Не удалось узнать, опубликована ли политика" message="Вердикт выше — по снимку стенда; правило «RL» в мастере плана недоступно."
        detail={s.error ?? undefined} onRetry={() => void ensureRlStatus(true)} />
    )
  }
  if (!st) return null
  const published = st.l0.ok || st.l2.ok
  return (
    <div className="ag-server">
      <span>Политика в продукте: <b className="ag-server__v">{published ? 'опубликована' : 'не опубликована'}</b></span>
      <details className="ag-details">
        <summary>Подробнее</summary>
        <dl className="ag-server__dl">
          {serverDetails(st).map((r) => (
            <div key={r.k}><dt>{r.k}</dt><dd className={r.mono ? 'mono' : undefined}>{r.v}</dd></div>
          ))}
        </dl>
      </details>
    </div>
  )
}

/** Лесной график претендентов V5: ДИ, IQM, ноль = правило, порог гейта — «весь ДИ правее нуля». */
export function VerdictForest() {
  const rows = v5Forest(V5, 'base')
  const lo = Math.min(0, ...rows.map((r) => r.lo))
  const hi = Math.max(1, ...rows.map((r) => r.hi))
  return (
    <Forest rows={rows} fmt={(v) => bpFine(v / 10_000, { signed: true })} domain={[Math.floor(lo), Math.ceil(hi)]}
      fmtShare={(v) => `${num(winCount(V5, v), 0)} из ${num(V5.instances.length, 0)}`}
      zeroLabel="0 = правило · гейт: весь ДИ правее" baseLabel="к лучшему правилу"
      title="Ни один претендент не выигрывает у правила с уверенностью"
      subtitle={`ΔCVaR прибыли при α = ${num(ALPHA_V5, 1)}, б. п., IQM по ${num(V5.instances.length, 0)} экземплярам · 95 %-ДИ бутстрепа · снимок ${snapDay(V5.snapshot_date)}`}
      ariaLabel={`Лесной график: ${rows.length} претендентов RL против лучшего правила; ни у одного ДИ не лежит правее нуля`} />
  )
}
