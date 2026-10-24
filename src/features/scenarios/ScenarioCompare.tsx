/**
 * Сравнение 2–5 сценариев (UX-V2 §5.3, X2 «сравнение — явная Δ к названной базе»): первая колонка —
 * рабочий (или первый отмеченный) сценарий «· база»; ячейки других — значение и Δ к базе с
 * направлением «лучше». Условия — эффективные значения (умолчание — «○ по умолчанию»), «только
 * отличающиеся» действует и на результаты. «Рассчитать портфели» не выключается заранее: при < 2
 * отмеченных объясняет по нажатию. У каждой колонки — «Сделать рабочим» и «убрать из сравнения».
 */
import { useMemo, useState } from 'react'
import { api, type OptResult, type PriceScenario, type Product } from '../../lib/api'
import { num } from '../../explain/format'
import { Icon } from '../../shell/icons'
import { DeltaChip, EmptyState, ErrorBanner, Switch } from '../../ui/kit'
import { buildLines, conditionRows, resultRows, visibleLines, type CompareLine } from './compareModel'
import { effectiveScenario } from './scenarioDefaults'
import { MAX_COMPARE } from './scenarioRoute'
import './scenarios-v2.css'

interface Props {
  scenarios: readonly PriceScenario[]
  ids: readonly string[]
  workingId: string
  products: readonly Product[]
  regimeNames: readonly string[]
  onMakeWorking: (id: string) => void
  onDrop: (id: string) => void
}

/** Порядок колонок: рабочий — первым (база), остальные — как отмечены. */
function orderColumns(scenarios: readonly PriceScenario[], ids: readonly string[], workingId: string): PriceScenario[] {
  const cols = ids.map((id) => scenarios.find((s) => s.id === id)).filter((s): s is PriceScenario => Boolean(s))
  const w = cols.findIndex((s) => s.id === workingId)
  return w > 0 ? [cols[w], ...cols.filter((_, i) => i !== w)] : cols
}

export function ScenarioCompare({ scenarios, ids, workingId, products, regimeNames, onMakeWorking, onDrop }: Props) {
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

  const condLines = visibleLines(buildLines(conditionRows(regimeNames), cols), onlyDiff)
  const ready = cols.every((c) => results[c.id]) ? cols : []
  const baseAlpha = cols[0] ? effectiveScenario(cols[0]).alpha : 0.1
  const resLines = ready.length >= 2 ? visibleLines(buildLines(resultRows(baseAlpha, nameOf), ready.map((c) => results[c.id])), onlyDiff) : []

  return (
    <div className="sc2-compare">
      <div className="sc2-compare__head">
        <h2 className="scn__h">Сравнение сценариев · {num(cols.length, 0)} из {num(MAX_COMPARE, 0)}</h2>
        <Switch checked={onlyDiff} onChange={setOnlyDiff} hint="Скрыть строки, где все сценарии совпадают">только отличающиеся</Switch>
        <button type="button" className="btn btn--primary" onClick={() => { void run() }} aria-busy={busy || undefined}>
          {busy ? 'Считаем портфели…' : `Рассчитать портфели (${num(cols.length, 0)})`}
        </button>
      </div>
      {tooFew && <ErrorBanner tone="setup" title="Нужно минимум два сценария" message="Отметьте в списке слева 2–5 сценариев и нажмите ещё раз." onDismiss={() => setTooFew(false)} />}
      {error !== null && <ErrorBanner title="Портфели не рассчитаны" error={error} onRetry={() => { void run() }} />}
      {cols.length < 2 ? (
        <EmptyState kind="first-use" title="Отметьте 2–5 сценариев — появятся отличия условий и портфели">
          Первым встанет рабочий сценарий — он база для разниц. Критерий и α берутся из каждого сценария, как в «Портфеле».
        </EmptyState>
      ) : (
        <>
          <CompareTable caption="Условия" cols={cols} workingId={workingId} lines={condLines} onMakeWorking={onMakeWorking} onDrop={onDrop}
            emptyText="Условия сценариев совпадают" />
          {resLines.length > 0 && (
            <CompareTable caption="Результаты робастной оптимизации" cols={ready} workingId={workingId} lines={resLines} onMakeWorking={onMakeWorking} onDrop={onDrop}
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
  emptyText: string
  onMakeWorking: (id: string) => void
  onDrop: (id: string) => void
}

function CompareTable({ caption, cols, workingId, lines, emptyText, onMakeWorking, onDrop }: TableProps) {
  const base = cols[0]?.name || 'база'
  return (
    <section className="sc2-cmp" aria-label={caption}>
      <h3 className="sc2-cmp__cap text-caps">{caption}</h3>
      {lines.length === 0 ? <p className="sc2-muted">{emptyText}</p> : (
        <div className="sc2-cmp__wrap">
          <table className="dk-table sc2-cmp__table">
            <thead>
              <tr>
                <th scope="col">Показатель</th>
                {cols.map((c, i) => (
                  <th key={c.id} scope="col" className="sc2-cmp__col">
                    <span className="sc2-cmp__name" title={c.name}>{c.name || 'Без названия'}{i === 0 && <span className="sc2-cmp__base"> · база</span>}</span>
                    <span className="sc2-cmp__acts">
                      {c.id === workingId
                        ? <span className="sc2-working">● рабочий</span>
                        : <button type="button" className="pf-link" onClick={() => onMakeWorking(c.id)}>Сделать рабочим</button>}
                      <button type="button" className="btn btn--ghost btn--icon btn--sm" onClick={() => onDrop(c.id)} aria-label={`Убрать «${c.name}» из сравнения`} title="Убрать из сравнения">
                        <Icon name="close" size={12} />
                      </button>
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.key}>
                  <th scope="row">{l.label}</th>
                  {l.cells.map((cell, i) => (
                    <td key={cols[i]?.id ?? i} className="num">
                      <span className="sc2-cmp__cell">
                        <span>{cell.text}</span>
                        {cell.isDefault && <span className="sc2-cmp__dflt" title="Не задано в сценарии — действует значение по умолчанию">○ по умолчанию</span>}
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
