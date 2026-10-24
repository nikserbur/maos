/**
 * Шапка конструктора техкарты: название, изделие, сводка «8 оп · Σ 407 мин», версия («v2 · действует ●»),
 * «не сохранено», справка «?» по клавишам (⌘/Ctrl по платформе) и одна primary «Сохранить»
 * (не выключается заранее: что мешает — объясняется при нажатии). Крошки — в верхней панели оболочки.
 */
import { useState, type Dispatch } from 'react'
import type { Product, Routing } from '../../../lib/api'
import { fmtValue, num } from '../../../explain/format'
import { isMacPlatform, shortcutText } from '../../../shell/commandIndex'
import { useEscapeLayer } from '../../../shell/overlays'
import { Chip } from '../../../ui/kit'
import { isDefaultRouting } from '../registries'
import type { RoutingAction, RoutingState } from './routingModel'

interface RoutingHeaderProps {
  state: RoutingState
  dispatch: Dispatch<RoutingAction>
  products: ReadonlyArray<Product>
  meta: Routing | null
  opsCount: number
  totalMin: number
  saving: boolean
  onCancel: () => void
  onSave: () => void
}

export function RoutingHeader({ state, dispatch, products, meta, opsCount, totalMin, saving, onCancel, onSave }: RoutingHeaderProps) {
  const mac = isMacPlatform()
  const saveKeys = shortcutText('mod+s', mac)
  const version = meta ? `v${meta.version || '1'} · ${isDefaultRouting(meta) ? 'действует ●' : 'альтернатива ○'}` : 'новая'
  return (
    <div className="rt-head__main">
      <input className="rt-head__name" value={state.name} placeholder="Название техкарты" aria-label="Название техкарты"
        onChange={(e) => dispatch({ type: 'SET_NAME', value: e.target.value })} />
      <select className="form__select rt-head__product" value={state.productId} aria-label="Изделие"
        onChange={(e) => dispatch({ type: 'SET_PRODUCT', value: e.target.value })}>
        <option value="">— изделие —</option>
        {products.map((p) => <option key={p.id} value={p.id}>{p.code ? `${p.code} — ` : ''}{p.name}</option>)}
      </select>
      <span className="rt-head__meta num">{num(opsCount, 0)} оп. · Σ {fmtValue(totalMin, 'мин')}</span>
      <Chip size="sm">{version}</Chip>
      {state.dirty && <Chip tone="idle" size="sm" title="Есть несохранённые изменения">не сохранено</Chip>}
      <span className="rt-head__actions">
        <KeysHelp mac={mac} />
        <button type="button" className="btn btn--ghost" onClick={onCancel} disabled={saving}>Отмена</button>
        <button type="button" className="btn btn--primary" onClick={onSave} aria-busy={saving || undefined}
          aria-keyshortcuts={mac ? 'Meta+S' : 'Control+S'} title={`Сохранить (${saveKeys})`}>
          {saving ? 'Сохраняем…' : 'Сохранить'}
        </button>
      </span>
    </div>
  )
}

/** «?» — клавиши конструктора; Esc закрывает только эту подсказку. */
function KeysHelp({ mac }: { mac: boolean }) {
  const [open, setOpen] = useState(false)
  useEscapeLayer('tip', () => setOpen(false), open)
  const rows: Array<[string, string]> = [
    ['Колесо', 'масштаб'], ['Перетаскивание фона', 'сдвиг'], ['F', 'вписать маршрут'],
    ['Enter на узле', 'выбрать операцию'], [shortcutText('mod+s', mac), 'сохранить'], ['Esc', 'закрыть конструктор'],
  ]
  return (
    <span className="rt-help">
      <button type="button" className="btn btn--ghost btn--icon" aria-expanded={open} aria-controls="rt-help-pop"
        aria-label="Клавиши конструктора" title="Клавиши конструктора" onClick={() => setOpen((v) => !v)}>?</button>
      {open && (
        <div className="rt-help__pop" id="rt-help-pop" role="dialog" aria-label="Клавиши конструктора">
          <dl className="rt-help__list">
            {rows.map(([k, v]) => <div key={k} className="rt-help__row"><dt><kbd>{k}</kbd></dt><dd>{v}</dd></div>)}
          </dl>
        </div>
      )}
    </span>
  )
}
