/**
 * Статус агента RL (A1 §5–6): живое состояние сервера (GET /api/rl/status — onnxruntime, файлы
 * политик L0/L2, SHA256) + вердикт гейта §7.4 из снимка V5 (лучший претендент, IQM ΔCVaR с 95 %-ДИ
 * на отложенных сценариях). Честная граница: без прошедшей гейт политики правило «RL» в «Плане»
 * не предлагается, чемпион — лучшее правило.
 */
import { dateTime, num, pct } from '../../explain/format'
import { RangeStrip } from '../../ui/charts'
import { Chip, ErrorBanner, Skeleton } from '../../ui/kit'
import { V5, ciVerdict, gateSummary, policyLabel } from './benchData'
import { ensureRlStatus, rlAvailable, rlReason, shortSha, useRlStatus } from './rlStatusStore'

// Разности долей E[Π] малы (10⁻⁵…10⁻³) — три знака, иначе всё округляется в «0 %».
const fmtShare = (v: number) => pct(v, 3)

export function RlStatusCard() {
  const s = useRlStatus()
  const st = s.status
  const ok = rlAvailable(st)
  const gate = gateSummary(V5)
  const best = gate.best
  const verdict = best ? ciVerdict(best.ci95) : 'straddles'
  return (
    <section className={`ag-status dk-card${ok ? ' is-live' : ''}`} aria-labelledby="ag-status-t">
      <div className="ag-status__verdict">
        <p className="text-caps ag-status__eyebrow" id="ag-status-t">Гейт §7.4 · отложенные сценарии · N = {num(V5.n, 0)} на экземпляр</p>
        <h2 className="ag-status__headline">
          {ok ? 'Политика опубликована — правило «RL» доступно в «Плане»'
            : gate.passed === 0 ? <>RL не прошёл гейт, <span className="ag-status__accent">чемпион — лучшее правило</span></>
              : 'Есть прошедшая гейт политика, но сервер её не видит'}
        </h2>
        <p className="ag-status__lead">
          {gate.passed} из {gate.candidates} претендентов (L0 и L2 × 3 сида) прошли гейт. Лучший — {best ? policyLabel(best.policy) : '—'}:
          IQM ΔCVaR₀.₁(Π) {best ? fmtShare(best.iqm) : '—'} от E[Π] против лучшего правила, ДИ 95 % {best ? `[${fmtShare(best.ci95[0])}; ${fmtShare(best.ci95[1])}]` : '—'}
          {verdict === 'straddles' ? ' — содержит ноль: отличия от правила нет.' : verdict === 'below' ? ' — целиком ниже нуля: хуже правила.' : ' — выше нуля.'}
        </p>
        {best && (
          <div className="ag-status__ci">
            <RangeStrip fmt={fmtShare} zone={[best.ci95[0], best.ci95[1]]} zoneLabel="95 %-ДИ бутстрепа"
              marks={[
                { key: 'zero', value: 0, label: 'ноль — без выигрыша', glyph: 'ring', tone: 'idle', showValue: true },
                { key: 'iqm', value: best.iqm, label: `IQM ${policyLabel(best.policy)}`, glyph: 'dot', tone: 'accent' },
              ]}
              ariaLabel={`ДИ выигрыша лучшего претендента ${fmtShare(best.ci95[0])} … ${fmtShare(best.ci95[1])}, IQM ${fmtShare(best.iqm)}; ноль внутри ДИ`} />
          </div>
        )}
        <div className="ag-status__chips">
          <Chip tone="idle" title={V5.source}>снимок V5 от {dateTime(V5.snapshot_date, { time: false })}</Chip>
          <Chip>holdout seed {V5.holdout_seed}</Chip>
          <Chip>{V5.instances.length} экземпляров MAOS · сиды {V5.seeds.join(', ')}</Chip>
        </div>
      </div>

      <dl className="ag-status__server" aria-label="Состояние сервера">
        <p className="text-caps ag-status__eyebrow">Сервер · сейчас</p>
        {s.load === 'loading' && !st && <><Skeleton w="80%" /><Skeleton w="60%" /><Skeleton w="70%" /></>}
        {s.load === 'error' && <ErrorBanner tone="setup" title="Статус политики недоступен" message={s.error ?? undefined} onRetry={() => void ensureRlStatus(true)} />}
        {st && (
          <>
            <div><dt>onnxruntime</dt><dd>{st.onnxruntime ? <Chip size="sm" tone="good">собран</Chip> : <Chip size="sm" tone="warn">нет · MAOS_WITH_ONNX=OFF</Chip>}</dd></div>
            <div><dt>Политика L0 (диспетчер)</dt><dd>{st.l0.ok ? <Chip size="sm" tone="good">{shortSha(st.l0.sha256)}</Chip> : <Chip size="sm" tone="idle">не опубликована</Chip>}</dd></div>
            <div><dt>Политика L2 (планировщик)</dt><dd>{st.l2.ok ? <Chip size="sm" tone="good">{shortSha(st.l2.sha256)}</Chip> : <Chip size="sm" tone="idle">не опубликована</Chip>}</dd></div>
            <div className="ag-status__why"><dt>Почему</dt><dd>{rlReason(s)}</dd></div>
            {st.error && <div className="ag-status__why"><dt>Ответ сервера</dt><dd className="mono">{st.error}</dd></div>}
          </>
        )}
        <div className="ag-status__act">
          {ok
            ? <a className="btn btn--primary btn--sm" href="#/plan/new/objective">Выбрать «RL» в мастере плана →</a>
            : <a className="btn btn--sm" href="#/plan/new/objective">Мастер плана: RL недоступно</a>}
          <a className="btn btn--ghost btn--sm" href="#/map/ag.rl">[6] на карте ↗</a>
        </div>
      </dl>
    </section>
  )
}
