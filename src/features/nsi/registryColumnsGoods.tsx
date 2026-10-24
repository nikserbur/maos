/**
 * Колонки реестров «Изделия», «Техкарты», «Операции» (P-44, P-46, P-47): цена по роли (закупка у сырья
 * и полуфабрикатов, продажа у товаров), «—» там, где поле не применимо; техкарты — действующая версия
 * и альтернативы под своим изделием; операции — по техкартам «ТК … · 8 оп · Σ 407 мин», без сырых id.
 */
import { countText, dateTimeShort, money, num, NBSP } from '../../explain/format'
import { Chip } from '../../ui/kit'
import { str, numOf, posOf, Muted, type AnyRow, type NsiColumn, type RegistryView, type ViewCtx } from './registryColumns'
import { ROLE_LABELS, ROLE_ORDER, isDefaultRouting, opTypeLabel, productRole, routingVariantName, splitName } from './registries'
import type { Operation, Routing } from '../../lib/api'

const OPS_FORMS = ['оп.', 'оп.', 'оп.'] as const
const VARIANT_FORMS = ['вариант', 'варианта', 'вариантов'] as const

/* ── Изделия ─────────────────────────────────────────────────────────────── */

export function productView(ctx: ViewCtx): RegistryView {
  const { lk } = ctx
  const role = (r: AnyRow) => productRole(r)
  const isProduct = (r: AnyRow) => role(r) === 'product'
  const unit = (r: AnyRow) => str(r, 'unit') || 'шт'
  const qty = (r: AnyRow, key: string) => {
    const v = numOf(r, key)
    return v === null ? '' : `${num(v)}${NBSP}${unit(r)}`
  }
  const parentText = (r: AnyRow) => {
    const p = lk.productById.get(str(r, 'parent_id'))
    return p ? `${p.code} ${p.name}` : ''
  }
  const notApplicable = <Muted title="Не применимо к этой роли">—</Muted>
  const columns: NsiColumn[] = [
    {
      key: 'item', title: 'Изделие', rowHeader: true, className: 'nsi-td-name', get: (r) => str(r, 'code') || str(r, 'name'),
      text: (r) => `${str(r, 'code')} ${str(r, 'name')}`,
      render: (r) => {
        const [head, tail] = splitName(str(r, 'name'))
        return (
          <span className="nsi-item" title={str(r, 'name')}>
            {str(r, 'code') && <span className="nsi-code mono">{str(r, 'code')}</span>}
            <span className="nsi-item__name">{head}</span>
            {tail && <span className="nsi-item__tail">{tail}</span>}
          </span>
        )
      },
    },
    { key: 'parent_id', title: 'Входит в', clip: true, get: parentText, text: parentText, render: (r) => parentText(r) || <Muted>—</Muted> },
    { key: 'stock', title: 'Остаток', num: true, get: (r) => numOf(r, 'stock'), text: (r) => qty(r, 'stock'), render: (r) => qty(r, 'stock') || <Muted>—</Muted> },
    {
      key: 'base_cost', title: 'Цена закупки, ₽', num: true, get: (r) => (isProduct(r) ? null : posOf(r, 'base_cost')),
      text: (r) => (isProduct(r) ? '' : posOf(r, 'base_cost') === null ? 'не задана' : money(posOf(r, 'base_cost'))),
      render: (r) => (isProduct(r) ? notApplicable : posOf(r, 'base_cost') === null ? <Muted>не задана</Muted> : money(posOf(r, 'base_cost'))),
    },
    {
      key: 'base_price', title: 'Цена продажи, ₽', num: true, get: (r) => (isProduct(r) ? posOf(r, 'base_price') : null),
      text: (r) => (isProduct(r) && posOf(r, 'base_price') !== null ? money(posOf(r, 'base_price')) : ''),
      render: (r) => (!isProduct(r) ? notApplicable : posOf(r, 'base_price') === null ? <Muted>не задана</Muted> : money(posOf(r, 'base_price'))),
    },
    {
      key: 'demand_max', title: 'Спрос в год', num: true, get: (r) => (isProduct(r) ? posOf(r, 'demand_max') : null),
      text: (r) => (isProduct(r) ? qty(r, 'demand_max') : ''),
      render: (r) => (!isProduct(r) ? notApplicable : posOf(r, 'demand_max') === null ? <Muted>не задан</Muted> : qty(r, 'demand_max')),
    },
    {
      key: 'market_capacity', title: 'Ёмкость рынка', num: true, get: (r) => (isProduct(r) ? posOf(r, 'market_capacity') : null),
      text: (r) => (isProduct(r) ? qty(r, 'market_capacity') : ''),
      render: (r) => (!isProduct(r) ? notApplicable : posOf(r, 'market_capacity') === null ? <Muted>не задана</Muted> : qty(r, 'market_capacity')),
    },
  ]
  const prepare = (rows: AnyRow[]) => [...rows].sort((a, b) =>
    ROLE_ORDER[role(a)] - ROLE_ORDER[role(b)] || str(a, 'code').localeCompare(str(b, 'code'), 'ru', { numeric: true }))
  return { columns, prepare, groupBy: (r) => ROLE_LABELS[role(r)] }
}

/* ── Техкарты ────────────────────────────────────────────────────────────── */

const productKey = (r: AnyRow) => str(r, 'product_id') || `—${str(r, 'id')}`

export function routingView(ctx: ViewCtx): RegistryView {
  const { lk } = ctx
  const product = (r: AnyRow) => lk.productById.get(str(r, 'product_id'))
  const variants = (r: AnyRow) => lk.variantsByProduct.get(str(r, 'product_id')) ?? 1
  const stats = (r: AnyRow) => lk.routingStats.get(str(r, 'id'))
  const sortKey = (r: AnyRow) => `${product(r)?.code ?? 'яяя'}|${isDefaultRouting(r) ? 0 : 1}|${str(r, 'name')}`
  const itemText = (r: AnyRow) => {
    const p = product(r)
    const variant = routingVariantName(str(r, 'name'), isDefaultRouting(r))
    return p ? (variants(r) > 1 ? variant : `${p.code} ${p.name}`) : `${str(r, 'name')} (без изделия)`
  }
  const versionText = (r: AnyRow) => {
    const v = str(r, 'version') || '1'
    return isDefaultRouting(r) ? `v${v} · действует ●` : `v${v} · альтернатива ○`
  }
  const columns: NsiColumn[] = [
    {
      key: 'product', title: 'Изделие', rowHeader: true, className: 'nsi-td-name', get: sortKey, text: (r) => `${itemText(r)} ${str(r, 'name')}`,
      render: (r) => {
        const p = product(r)
        if (!p) return <span className="nsi-item">{str(r, 'name')} <Muted>без изделия</Muted></span>
        if (variants(r) > 1) return <span className="nsi-item nsi-item--variant" title={str(r, 'name')}>{itemText(r)}</span>
        return (
          <span className="nsi-item" title={str(r, 'name')}>
            <span className="nsi-code mono">{p.code}</span><span className="nsi-item__name">{p.name}</span>
          </span>
        )
      },
    },
    { key: 'version', title: 'Версия', get: (r) => (isDefaultRouting(r) ? 0 : 1), text: versionText, render: (r) => <Chip size="sm">{versionText(r)}</Chip> },
    { key: 'ops', title: 'Операций', num: true, get: (r) => stats(r)?.ops ?? 0, text: (r) => num(stats(r)?.ops ?? 0, 0) },
    { key: 'total', title: 'Σ норм. время, мин', num: true, get: (r) => stats(r)?.totalMin ?? 0, text: (r) => num(stats(r)?.totalMin ?? 0, 0) },
    {
      key: 'longest', title: 'Самая длинная операция', clip: true, get: (r) => stats(r)?.longest?.min ?? null,
      text: (r) => {
        const l = stats(r)?.longest
        return l ? `${l.name} · ${num(l.min, 0)}${NBSP}мин` : ''
      },
    },
    { key: 'updated', title: 'Обновлено', get: (r) => str(r, 'effective_from') || str(r, 'created_at'), text: (r) => dateTimeShort(str(r, 'effective_from') || str(r, 'created_at')) },
  ]
  return {
    columns,
    prepare: (rows) => [...rows].sort((a, b) => sortKey(a).localeCompare(sortKey(b), 'ru', { numeric: true })),
    groupBy: productKey,
    // Подзаголовок — только у изделий с вариантами: 70 заголовков по одной строке были бы шумом.
    groupLabel: (key, count) => {
      if (count < 2) return undefined
      const p = lk.productById.get(key)
      return p ? `${p.code} ${p.name} · ${countText(count, VARIANT_FORMS)}` : undefined
    },
  }
}

/* ── Операции ────────────────────────────────────────────────────────────── */

const TEMPLATES = 'Шаблоны операций (без техкарты)'

function routingOrder(routings: ReadonlyArray<Routing>, ctx: ViewCtx): Map<string, string> {
  const out = new Map<string, string>()
  for (const r of routings) {
    const code = ctx.lk.productById.get(r.product_id)?.code ?? 'яяя'
    out.set(r.id, `${code}|${isDefaultRouting(r) ? 0 : 1}|${r.name}`)
  }
  return out
}

export function operationView(ctx: ViewCtx): RegistryView {
  const { lk, data } = ctx
  const order = routingOrder(data.routings, ctx)
  const asOp = (r: AnyRow) => r as unknown as Operation
  const types = (r: AnyRow) => lk.typesOfOp(asOp(r)).map((t) => t.name).join(', ')
  const timeText = (r: AnyRow) => {
    const n = numOf(r, 't_norm')
    if (n === null) return ''
    const lo = numOf(r, 't_opt')
    const hi = numOf(r, 't_pess')
    return lo !== null && hi !== null && (lo !== n || hi !== n) ? `${num(n, 0)} · ${num(lo, 0)}–${num(hi, 0)}` : num(n, 0)
  }
  const routingName = (r: AnyRow) => {
    const rt = lk.routingById.get(str(r, 'routing_id'))
    return rt ? routingVariantName(rt.name, isDefaultRouting(rt)) : ''
  }
  const columns: NsiColumn[] = [
    { key: 'name', title: 'Наименование', rowHeader: true, clip: true, text: (r) => str(r, 'name') },
    { key: 'order_no', title: 'Шаг', num: true, get: (r) => numOf(r, 'order_no'), text: (r) => num(numOf(r, 'order_no'), 0) },
    { key: 'code', title: 'Код', text: (r) => str(r, 'code'), render: (r) => (str(r, 'code') ? <span className="mono">{str(r, 'code')}</span> : <Muted>—</Muted>) },
    { key: 'op_type', title: 'Тип', text: (r) => opTypeLabel(str(r, 'op_type')), render: (r) => opTypeLabel(str(r, 'op_type')) || <Muted>—</Muted> },
    {
      key: 'wc_types', title: 'Тип оборудования', clip: true, get: types, text: (r) => types(r) || 'тип не задан',
      render: (r) => types(r) || (data.wcTypes.length ? <Chip tone="setup" size="sm">тип не задан</Chip> : str(r, 'wc_types')),
    },
    {
      key: 't_norm', title: 'Время, мин', num: true, get: (r) => numOf(r, 't_norm'), hint: 'Норма · оптимистичное–пессимистичное (PERT)',
      text: timeText, render: (r) => timeText(r) || <Muted>не задано</Muted>,
    },
    {
      key: 'setup_time', title: 'Наладка, мин', num: true, get: (r) => posOf(r, 'setup_time'),
      text: (r) => (posOf(r, 'setup_time') === null ? '' : num(posOf(r, 'setup_time'), 0)),
      render: (r) => (posOf(r, 'setup_time') === null ? <Muted>—</Muted> : num(posOf(r, 'setup_time'), 0)),
    },
  ]
  const groupOf = (r: AnyRow) => str(r, 'routing_id') || TEMPLATES
  const groupLabel = (key: string, count: number) => {
    if (key === TEMPLATES) return `${TEMPLATES} · ${num(count, 0)}`
    const rt = lk.routingById.get(key)
    const st = lk.routingStats.get(key)
    const name = rt ? routingVariantName(rt.name, isDefaultRouting(rt)) : 'Техкарта'
    return `${name} · ${countText(count, OPS_FORMS)} · Σ${NBSP}${num(st?.totalMin ?? 0, 0)}${NBSP}мин`
  }
  const prepare = (rows: AnyRow[]) => [...rows].sort((a, b) => {
    const ga = order.get(str(a, 'routing_id')) ?? 'яяяя'
    const gb = order.get(str(b, 'routing_id')) ?? 'яяяя'
    return ga.localeCompare(gb, 'ru', { numeric: true }) || (numOf(a, 'order_no') ?? 0) - (numOf(b, 'order_no') ?? 0)
  })
  return { columns, prepare, groupBy: groupOf, groupLabel, groupText: routingName }
}
