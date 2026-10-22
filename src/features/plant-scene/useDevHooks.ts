/**
 * DEV-only: детерминированный вход в завод/цех и выбор станка из консоли для визуальной
 * верификации (window.__maos.enterShop(i) / .root()). В прод-сборку не попадает.
 */
import { useEffect, type Dispatch } from 'react'
import type { GraphAction, GraphState } from './graph/graphReducer'

export function useDevHooks(state: GraphState, dispatch: Dispatch<GraphAction>): void {
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const byTitle = <T extends { title: string }>(list: T[], sel: number | string): T | undefined =>
      typeof sel === 'number' ? list[sel] : list.find((x) => x.title.toLowerCase().includes(String(sel).toLowerCase()))
    const factories = () => state.graph.nodes.filter((n) => n.refType === 'factory')
    // Цеха текущего завода (когда мы внутри завода) — для верификации входа.
    const shops = () => state.graph.nodes.filter((n) => n.refType === 'shop' && n.parentId === state.currentParentId)
    Object.assign(window, {
      __maos: {
        factories: () => factories().map((f, i) => `${i}: ${f.title}`),
        enterFactory: (sel: number | string = 0) => {
          const f = byTitle(factories(), sel)
          if (f) dispatch({ type: 'ENTER_NODE', id: f.id })
          return f?.title ?? null
        },
        shops: () => shops().map((s, i) => `${i}: ${s.title}`),
        enterShop: (sel: number | string = 0) => {
          const shop = byTitle(shops(), sel)
          if (shop) dispatch({ type: 'ENTER_NODE', id: shop.id })
          return shop?.title ?? null
        },
        selectMachine: (i = 0) => {
          const ms = state.graph.nodes.filter((n) => n.parentId === state.currentParentId && n.refType === 'machine')
          if (ms[i]) dispatch({ type: 'NODE_CLICK', id: ms[i].id })
          return ms[i]?.title ?? null
        },
        root: () => dispatch({ type: 'GO_TO_LEVEL', index: 0 }),
      },
    })
  }, [state.graph, state.currentParentId, dispatch])
}
