/**
 * Сравнение 2–5 сценариев (UX-V2 §5.3, X2 «сравнение — явная Δ к названной базе»): первая колонка —
 * рабочий (или первый отмеченный) сценарий «· база»; ячейки других — значение и Δ к базе с
 * направлением «лучше». Условия — эффективные значения (умолчание — серый глиф ○/●/◆ с подсказкой
 * источника), «только отличающиеся» действует и на результаты. Таблица — фиксированная раскладка:
 * «Показатель» 14rem и липкая, сценарии делят остальное поровну (не уже 12rem, не шире 280 px);
 * в шапке — короткое имя пресета, месяцы — полностью. «Рассчитать портфели» не выключается заранее: при < 2
 * отмеченных объясняет по нажатию. У каждой колонки — «Сделать рабочим» и «убрать из сравнения».
 */
import { useMemo, useState } from 'react'
import { api, type MacroLastObs, type OptResult, type PriceScenario, type Product } from '../../lib/api'
import { num } from '../../explain/format'
import { Icon } from '../../shell/icons'
import { DeltaChip, EmptyState, ErrorBanner, Switch } from '../../ui/kit'
import { buildLines, conditionRows, resultRows, visibleLines, type CompareLine } from './compareModel'
import { effectiveScenario } from './scenarioDefaults'
import { fullMonths } from './monthWords'
import { scenarioView } from './scenarioPresets'
import { MAX_COMPARE } from './scenarioRoute'
import './scenarios-v2.css'

interface Props {
  scenarios: readonly PriceScenario[]
  ids: readonly string[]
  workingId: string
  products: readonly Product[]
  regimeNames: readonly string[]
  /** Точка старта генератора (ЦБ РФ) — умолчание инфляции. */
  lastObs?: MacroLastObs | null
  /** Индекс кризисного режима генератора. */
  crisisIndex?: number
  onMakeWorking: (id: string) => void
  onDrop: (id: string) => void
}

/** Порядок колонок: рабочий — первым (база), остальные — как отмечены. */
function orderColumns(scenarios: readonly PriceScenario[], ids: readonly string[], workingId: string): PriceScenario[] {
  const cols = ids.map((id) => scenarios.find((s) => s.id === id)).filter((s): s is PriceScenario => Boolean(s))
  const w = cols.findIndex((s) => s.id === workingId)
  return w > 0 ? [cols[w], ...cols.filter((_, i) => i !== w)] : cols
}

export function ScenarioCompare({ scenarios, ids, workingId, products, regimeNames, lastObs, crisisIndex = 1, onMakeWorking, onDrop }: Props) {
  const [results, setResults] = useState<Record<string, OptResult>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [tooFew, setTooFew] = useState(false)
  const [onlyDiff, setOnlyDiff] = useState(true)
  const cols = orderColumns(scenarios, ids, workingId)
  const nameOf = useMemo(() => {
    const m = new Map(products.map((p) => [p.id, p.name]))
    return (id: string) => m.get(id) ?? 'изделие без имени'
  }, [products])

  const run = async () => {
    if (cols.length < 2) { setTooFew(true); return }
    setTooFew(false); setBusy(true); setError(null)
    try {
      const out: Record<string, OptResult> = { ...results }
      for (const sc of cols) if (!out[sc.id]) out[sc.id] = await api.optimize.run({ scenario_id: sc.id })
      setResults(out)
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }

  const condLines = visibleLines(buildLines(conditionRows(regimeNames, lastObs), cols), onlyDiff)
  const ready = cols.every((c) => results[c.id]) ? cols : []
  const baseAlpha = cols[0] ? effectiveScenario(cols[0]).alpha : 0.1
  const resLines = ready.length >= 2 ? visibleLines(buildLines(resultRows(baseAlpha, nameOf, crisisIndex), ready.map((c) => results[c.id])), onlyDiff) : []
  const months = cols.map((c) => effectiveScenario(c).months)
  const mixedHorizon = months.some((m) => m !== months[0])

  return (
    <div className="sc2-compare">
      <div className="sc2-compare__head">
        <h2 className="scn__h">Сравнение сценариев · {num(cols.length, 0)} из {num(MAX_COMPARE, 0)}</h2>
        <Switch checked={onlyDiff} onChange={setOnlyDiff} hint="Скрыть строки, где все сценарии совпадают">только отличающиеся</Switch>
        <button type="button" className="btn btn--primary" onClick={() => { void run() }} aria-busy={busy || undefined}>
          {busy ? 'Считаем портфели…' : `Рассчитать портфели (${num(cols.length, 0)})`}
        </button>
      </div>
      {mixedHorizon && cols.length >= 2 && (
        <ErrorBanner tone="setup" title="У сценариев разный горизонт прогноза"
          message={`Горизонты: ${cols.map((c, i) => `«${c.name || 'Без названия'}» — ${num(months[i], 0)} мес`).join(', ')}. Разницы условий и портфелей читайте с поправкой на срок.`} />
      )}
      {tooFew && <ErrorBanner tone="setup" title="Нужно минимум два сценария" message="Отметьте в списке слева 2–5 сценариев и нажмите ещё раз." onDismiss={() => setTooFew(false)} />}
      {error !== null && <ErrorBanner title="Портфели не рассчитаны" error={error} onRetry={() => { void run() }} />}
      {cols.length < 2 ? (
        <EmptyState kind="first-use" title="Отметьте 2–5 сценариев — появятся отличия условий и портфели">
          Первым встанет рабочий сценарий — он база для разниц. Критерий и α берутся из каждого сценария, как в «Портфеле».
        </EmptyState>
      ) : (
        <>
          <CompareTable caption="Условия" cols={cols} workingId={workingId} lines={condLines} regimeNames={regimeNames} onMakeWorking={onMakeWorking} onDrop={onDrop}
            emptyText="Условия сценариев совпадают" />
          {resLines.length > 0 && (
            <CompareTable caption="Результаты робастной оптимизации" cols={ready} workingId={workingId} lines={resLines} regimeNames={regimeNames} onMakeWorking={onMakeWorking} onDrop={onDrop}
              emptyText="Результаты совпадают" />
          )}
        </>
      )}
    </div>
  )
}

interface TableProps {
  caption: string
  cols: readonly PriceScenario[]
  workingId: string
  lines: readonly CompareLine[]
  regimeNames: readonly string[]
  emptyText: string
  onMakeWorking: (id: string) => void
  onDrop: (id: string) => void
}

/** Глиф происхождения умолчания: «● ЦБ РФ, сентябрь 2026» → «●»; без источника — «○». */
const originGlyph = (origin: string | undefined): string => (origin && /^[●◆○]/.test(origin) ? origin[0] : '○')

function DefaultMark({ origin }: { origin?: string }) {
  const source = origin ? fullMonths(origin.replace(/^[●◆○]\s*/, '')) : 'значение движка'
  const tip = `Не задано в сценарии — по умолчанию: ${source}`
  return <span className="sc2-cmp__dflt" title={tip} aria-label={tip}>{originGlyph(origin)}</span>
}

function ColumnHead({ c, isBase, workingId, regimeNames, onMakeWorking, onDrop }: {
  c: PriceScenario; isBase: boolean; workingId: string; regimeNames: readonly string[]; onMakeWorking: (id: string) => void; onDrop: (id: string) => void
}) {
  const v = scenarioView(c.macro_mode, regimeNames)
  return (
    <th scope="col" className="sc2-cmp__col">
      <span className="sc2-cmp__name">{c.name || 'Без названия'}{isBase && <span className="sc2-cmp__base"> · база</span>}</span>
      <span className="sc2-cmp__mode" title={fullMonths(v.mode)}>{v.preset ? v.preset.short : 'Своя настройка'} · {v.kind}</span>
      <span className="sc2-cmp__acts">
        {c.id === workingId
          ? <span className="sc2-working">● рабочий</span>
          : <button type="button" className="pf-link" onClick={() => onMakeWorking(c.id)}>Сделать рабочим</button>}
        <button type="button" className="btn btn--ghost btn--icon btn--sm" onClick={() => onDrop(c.id)} aria-label={`Убрать «${c.name}» из сравнения`} title="Убрать из сравнения">
          <Icon name="close" size={12} />
        </button>
      </span>
    </th>
  )
}

function CompareTable({ caption, cols, workingId, lines, regimeNames, emptyText, onMakeWorking, onDrop }: TableProps) {
  // «+0,35 к базе»: имя в именительном падеже после «к» читается с ошибкой («к Базовый»); база названа в шапке колонки.
  const base = 'базе'
  const n = Math.min(5, Math.max(2, cols.length))
  return (
    <section className="sc2-cmp" aria-label={caption}>
      <h3 className="sc2-cmp__cap">{caption}</h3>
      {lines.length === 0 ? <p className="sc2-muted">{emptyText}</p> : (
        <div className="sc2-cmp__wrap">
          <table className={`dk-table sc2-cmp__table sc2-cmp__table--n${n}`}>
            <colgroup>
              <col className="sc2-cmp__c0" />
              {cols.map((c) => <col key={c.id} />)}
            </colgroup>
            <thead>
              <tr>
                <th scope="col" className="sc2-cmp__lead">Показатель</th>
                {cols.map((c, i) => (
                  <ColumnHead key={c.id} c={c} isBase={i === 0} workingId={workingId} regimeNames={regimeNames} onMakeWorking={onMakeWorking} onDrop={onDrop} />
                ))}
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.key}>
                  <th scope="row" className="sc2-cmp__lead">{l.label}</th>
                  {l.cells.map((cell, i) => (
                    <td key={cols[i]?.id ?? i} className="num">
                      <span className="sc2-cmp__cell">
                        <span className="sc2-cmp__v">{fullMonths(cell.text)}</span>
                        {cell.isDefault && <DefaultMark origin={cell.origin} />}
                        {cell.delta !== null && <DeltaChip value={cell.delta} fmt={l.deltaFmt} better={l.better} base={base} />}
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
