/**
 * Глобальные панели оболочки (UX-V2 §7 G4): командная палитра (Cmd/Ctrl+K) и боковая панель
 * MENTAT (Cmd/Ctrl+J). Одно маленькое хранилище: открывает верхняя панель, клавиатура, палитра
 * (действие «Спросить MENTAT») и контекстное действие узла карты / «i» показателя — тогда панель
 * открывается с узлом вопроса (`mentatFocus`); экраны не знают о панелях.
 */
import { useEffect, useRef, useSyncExternalStore } from 'react'

export interface Overlays { palette: boolean; mentat: boolean; mentatFocus: string | null }

let state: Overlays = { palette: false, mentat: false, mentatFocus: null }
const listeners = new Set<() => void>()

function commit(next: Overlays): void {
  if (next.palette === state.palette && next.mentat === state.mentat && next.mentatFocus === state.mentatFocus) return
  state = next
  listeners.forEach((l) => l())
}
function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => { listeners.delete(l) }
}
const snapshot = (): Overlays => state

export function useOverlays(): Overlays {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

export const overlayActions = {
  openPalette: () => commit({ ...state, palette: true }),
  closePalette: () => commit({ ...state, palette: false }),
  togglePalette: () => commit({ ...state, palette: !state.palette }),
  openMentat: () => commit({ ...state, palette: false, mentat: true }),
  closeMentat: () => commit({ ...state, mentat: false }),
  toggleMentat: () => commit({ ...state, mentat: !state.mentat }),
  /** «Спросить MENTAT» об узле карты: панель открывается с этим узлом вопроса. */
  askMentat: (nodeId: string) => commit({ palette: false, mentat: true, mentatFocus: nodeId }),
  clearMentatFocus: () => commit({ ...state, mentatFocus: null }),
}

/* ── Стек Esc (X2: Esc закрывает только самый внутренний слой) ──────────────
 * Порядок: подсказка «i» → меню → палитра → боковая панель / модалка → MENTAT → сцена.
 * Один слушатель на document (всплытие): обработчики, уже вызвавшие preventDefault, не трогаем;
 * первый Esc в textarea/select только снимает фокус; иначе закрывается верхний активный слой
 * (ранг, затем порядок регистрации) и событие дальше не идёт (window-слушатели его не видят). */

export type EscapeKind = 'tip' | 'menu' | 'palette' | 'panel' | 'modal' | 'mentat' | 'scene'

const RANK: Readonly<Record<EscapeKind, number>> = { tip: 60, menu: 50, palette: 40, panel: 30, modal: 30, mentat: 20, scene: 10 }

interface EscapeLayer { id: number; kind: EscapeKind; close: () => void }

let layerSeq = 0
const layers: EscapeLayer[] = []

/** Верхний слой: наибольший ранг, при равенстве — открытый последним. */
export function topEscapeLayer(): EscapeLayer | undefined {
  let top: EscapeLayer | undefined
  for (const l of layers) if (!top || RANK[l.kind] > RANK[top.kind] || (RANK[l.kind] === RANK[top.kind] && l.id > top.id)) top = l
  return top
}

/** Зарегистрировать слой; возвращает снятие. */
export function pushEscapeLayer(kind: EscapeKind, close: () => void): () => void {
  const layer = { id: ++layerSeq, kind, close }
  layers.push(layer)
  ensureEscapeListener()
  return () => {
    const at = layers.indexOf(layer)
    if (at >= 0) layers.splice(at, 1)
  }
}

/** Обработка Esc стеком (экспорт — для теста): true — событие поглощено. */
export function handleEscape(e: Pick<KeyboardEvent, 'key' | 'defaultPrevented' | 'target' | 'preventDefault' | 'stopPropagation'>): boolean {
  if (e.key !== 'Escape' || e.defaultPrevented) return false
  const top = topEscapeLayer()
  if (!top) return false
  const target = e.target as HTMLElement | null
  const tag = target?.tagName
  if ((tag === 'TEXTAREA' || tag === 'SELECT') && typeof target?.blur === 'function') {
    target.blur()
    e.preventDefault()
    return true
  }
  e.preventDefault()
  e.stopPropagation()
  top.close()
  return true
}

let listening = false
function ensureEscapeListener(): void {
  if (listening || typeof document === 'undefined') return
  listening = true
  document.addEventListener('keydown', (e) => { handleEscape(e) })
}

/** Хук слоя: пока `active`, Esc закрывает его (если он самый внутренний). */
export function useEscapeLayer(kind: EscapeKind, onClose: () => void, active = true): void {
  const ref = useRef(onClose)
  ref.current = onClose
  useEffect(() => {
    if (!active) return undefined
    return pushEscapeLayer(kind, () => ref.current())
  }, [kind, active])
}

/** Только для тестов. */
export function resetEscapeLayersForTests(): void {
  layers.splice(0, layers.length)
}
