/**
 * Экран «Сценарии» V2 (UX-V2 §5.1): слева реестр (открыть сценарий → ScenarioTabs; «Сравнить» —
 * режим списка с N отметками → ScenarioCompare), создание из шаблона (ScenarioCreateDialog),
 * удаление с подтверждением. Ползунки и поля сохраняются с задержкой 400 мс (один PUT на серию
 * движений), уход с экрана досылает несохранённое; открытый сценарий — контекст решения.
 */
import { useEffect, useRef, useState } from 'react'
import { api, type MacroMode, type MacroModeName, type MacroRegimes, type PriceScenario, type Product, type ScenarioPayload, type PriceDistribution } from '../../lib/api'
import { setDecisionContext } from '../../shell/context'
import { BlockChips } from '../../ui/BlockChip'
import { IconButton } from '../../ui/kit'
import { Icon } from '../../shell/icons'
import { num, pct } from '../../explain/format'
import { ConfirmDialog } from '../../ui/ConfirmDialog'
import { invalidateScenario, useRefs, ensureRefs } from '../method-map/useMethodMapState'
import { ScenarioCompare } from './ScenarioCompare'
import { ScenarioCreateDialog } from './ScenarioCreateDialog'
import { ScenarioTabs, type SaveStatus } from './ScenarioTabs'
import { fromMacroMode, regimeLabel } from './regimeMenu'
import type { ScenarioTemplate } from './scenarioTemplates'
import './scenario-compare.css'
import './scenarios-v2.css'

/** Ползунки сохраняются с задержкой: один PUT на серию движений, а не на каждый тик (UX-V2 §5.1). */
const SAVE_DEBOUNCE_MS = 400

const OBJECTIVES: Record<string, string> = { cvar: 'CVaR', worstcase: 'maximin', meanvariance: 'E − λσ', minregret: 'Сэвидж' }

/** `macro_mode` сценария хранится строкой (JSON | имя); в payload уходит объект/имя. */
function macroModeOf(raw: string | undefined): MacroMode | MacroModeName | undefined {
  if (!raw) return undefined
  if (raw === 'base' || raw === 'regime' || raw === 'quantile' || raw === 'episode' || raw === 'iid_v063') return raw
  try { return JSON.parse(raw) as MacroMode } catch { return undefined }
}

export function ScenarioCompareScreen() {
  const [scenarios, setScenarios] = useState<PriceScenario[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [regimes, setRegimes] = useState<MacroRegimes | null>(null)
  const [sel, setSel] = useState<string[]>([])
  const [openId, setOpenId] = useState('')
  const [compareMode, setCompareMode] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [removeId, setRemoveId] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<Record<string, SaveStatus>>({})
  const saveTimers = useRef(new Map<string, number>())
  const pending = useRef(new Map<string, PriceScenario>())
  const refs = useRefs()

  const openScenario = (id: string) => { setOpenId(id); setDecisionContext({ scenarioId: id }) }
  useEffect(() => { if (!openId && scenarios.length) openScenario(scenarios[0].id) }, [scenarios, openId]) // eslint-disable-line react-hooks/exhaustive-deps

  const load = async () => {
    const list = await api.scenarios.list().catch(() => [] as PriceScenario[])
    const full = await Promise.all(list.map((s) => api.scenarios.get(s.id).catch(() => s)))
    setScenarios(full)
  }
  useEffect(() => {
    load()
    void ensureRefs()
    api.products.list().then((ps) => setProducts(ps.filter((p) => p.sellable === '1' || p.purchased === '1'))).catch(() => {})
    api.macro.regimes().then(setRegimes).catch(() => setRegimes(null))
  }, [])

  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))

  const payloadOf = (sc: PriceScenario, extra: Partial<ScenarioPayload>): ScenarioPayload => ({
    name: sc.name, description: sc.description,
    horizon_hours: Number(sc.horizon_hours) || 720, market_corr: Number(sc.market_corr) || 0.5,
    objective: sc.objective || 'cvar', alpha: Number(sc.alpha) || 0.1, max_share: Number(sc.max_share) || 0.6,
    mode: sc.mode || 'stochastic', plan_id: sc.plan_id || '', start_date: sc.start_date || '', end_date: sc.end_date || '',
    inflation: Number(sc.inflation) || 0, fx: Number(sc.fx) || 1, demand: Number(sc.demand) || 1,
    volatility: Number(sc.volatility) || 0.05, months: Number(sc.months) || 6,
    sanctions: Number(sc.sanctions) || 0, tax_change: Number(sc.tax_change) || 0, energy: Number(sc.energy) || 1, logistics: Number(sc.logistics) || 1, key_rate: Number(sc.key_rate) || 8,
    macro_mode: macroModeOf(sc.macro_mode),
    ...extra,
  })

  const flushSave = (id: string) => {
    const next = pending.current.get(id)
    saveTimers.current.delete(id)
    if (!next) return
    pending.current.delete(id)
    api.scenarios.update(id, payloadOf(next, {}))
      .then(() => { setSaveStatus((st) => ({ ...st, [id]: 'saved' })); invalidateScenario(id) })
      .catch(() => setSaveStatus((st) => ({ ...st, [id]: 'error' })))
  }
  const patch = (sc: PriceScenario, p: Partial<PriceScenario>) => {
    const next = { ...(pending.current.get(sc.id) ?? sc), ...p }
    setScenarios((list) => list.map((x) => (x.id === sc.id ? next : x)))
    pending.current.set(sc.id, next)
    setSaveStatus((st) => ({ ...st, [sc.id]: 'pending' }))
    const prev = saveTimers.current.get(sc.id)
    if (prev) window.clearTimeout(prev)
    saveTimers.current.set(sc.id, window.setTimeout(() => flushSave(sc.id), SAVE_DEBOUNCE_MS))
  }
  useEffect(() => () => {
    for (const id of [...saveTimers.current.keys()]) { window.clearTimeout(saveTimers.current.get(id)); flushSave(id) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const distDefault = (productId: string): PriceDistribution => {
    const p = products.find((x) => x.id === productId)
    const base = Number((p?.purchased === '1' ? p?.base_cost : p?.base_price) || 0)
    return { product_id: productId, dist_type: 'normal', mean: base, stddev: Math.round(base * 0.12), beta: 0.7 }
  }
  const setDists = async (sc: PriceScenario, rows: PriceDistribution[]) => {
    const ids = new Set(rows.map((r) => r.product_id))
    const distributions = [...(sc.distributions ?? []).filter((d) => !ids.has(d.product_id)), ...rows]
    const next = { ...sc, distributions }
    setScenarios((list) => list.map((x) => (x.id === sc.id ? next : x)))
    pending.current.set(sc.id, next)
    await api.scenarios.update(sc.id, payloadOf(next, { distributions })).then(() => invalidateScenario(sc.id)).catch(() => {})
  }
  const setDist = (sc: PriceScenario, productId: string, p: Partial<PriceDistribution>) => {
    const cur = (sc.distributions ?? []).find((d) => d.product_id === productId) ?? distDefault(productId)
    return setDists(sc, [{ ...cur, ...p }])
  }

  const clone = async (id: string) => { await api.scenarios.clone(id).catch(() => {}); load() }
  const remove = async (id: string) => {
    await api.scenarios.delete(id).catch(() => {})
    setRemoveId(null); setSel((s) => s.filter((x) => x !== id)); if (openId === id) setOpenId(''); load()
  }
  const createScenario = async (name: string, description: string, tpl: ScenarioTemplate | null) => {
    setCreating(true)
    const sc = await api.scenarios.create({
      name, description: description || undefined, ...(tpl?.values ?? {}),
      distributions: products.map((p) => distDefault(p.id)),
    }).catch(() => null)
    setCreating(false); setCreateOpen(false)
    await load()
    if (sc?.id) { openScenario(sc.id); setCompareMode(false) }
  }

  const selected = scenarios.find((s) => s.id === openId) ?? null
  return (
    <div className="scn">
      <aside className="scn__side">
        <div className="scn__side-top">
          <span className="scn__side-title">Сценарии</span>
          <IconButton icon="plus" variant="primary" title="Создать сценарий из шаблона" onClick={() => setCreateOpen(true)} />
        </div>
        <div className="scn__side-blocks"><BlockChips blocks={['external', 'distributions', 'criteria']} /></div>
        <div className="scn__cmpwrap">
          <IconButton icon="shuffle" pressed={compareMode} title="Сравнить два и более сценариев" onClick={() => { setCompareMode((m) => !m); setSel([]) }}>
            Сравнить сценарии{compareMode && sel.length ? ` (${num(sel.length, 0)})` : ''}
          </IconButton>
        </div>
        <div className="scn__list">
          {scenarios.map((sc) => {
            const active = compareMode ? sel.includes(sc.id) : sc.id === openId
            const regime = regimeLabel(fromMacroMode(sc.macro_mode), regimes?.regimes.map((r) => r.label))
            return (
              <button key={sc.id} className={`scn__item${active ? ' scn__item--active' : ''}`} onClick={() => (compareMode ? toggle(sc.id) : openScenario(sc.id))}>
                {compareMode && <span className={`scn__check${sel.includes(sc.id) ? ' scn__check--on' : ''}`}>{sel.includes(sc.id) && <Icon name="check" size={12} />}</span>}
                <span className="scn__item-main">
                  <span className="scn__item-name">{sc.name}</span>
                  <span className="scn__item-sub">{OBJECTIVES[sc.objective || 'cvar'] ?? 'CVaR'} · α {pct(Number(sc.alpha) || 0.1, 0)} · {regime.isForecast ? 'прогноз' : 'стресс'}</span>
                </span>
              </button>
            )
          })}
          {!scenarios.length && <p className="scn__empty">Нет сценариев.<br />«+» — создать из шаблона.</p>}
        </div>
      </aside>

      <main className="scn__main">
        {compareMode ? (
          <ScenarioCompare scenarios={scenarios} selected={sel} />
        ) : selected ? (
          <ScenarioTabs key={selected.id} sc={selected} products={products} saveStatus={saveStatus[selected.id]} regimes={regimes} macro={refs.macro}
            onPatch={patch} onSetDist={setDist} onSetDists={setDists} onClone={() => clone(selected.id)} onRemove={() => setRemoveId(selected.id)} />
        ) : (
          <div className="scn__placeholder">Выберите сценарий слева или создайте новый («+»).</div>
        )}
      </main>

      {createOpen && <ScenarioCreateDialog busy={creating} onSubmit={createScenario} onCancel={() => setCreateOpen(false)} />}
      {removeId && (
        <ConfirmDialog title="Удалить сценарий?" confirmLabel="Удалить" danger onConfirm={() => remove(removeId)} onCancel={() => setRemoveId(null)}>
          Сценарий <b>«{scenarios.find((s) => s.id === removeId)?.name ?? removeId}»</b> и его распределения цен будут удалены.
          Портфели, посчитанные под него, останутся в истории прогонов.
        </ConfirmDialog>
      )}
    </div>
  )
}
