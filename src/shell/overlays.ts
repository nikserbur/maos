/**
 * Глобальные панели оболочки (UX-V2 §7 G4): командная палитра (Cmd/Ctrl+K) и боковая панель
 * MENTAT (Cmd/Ctrl+J). Одно маленькое хранилище: открывает верхняя панель, клавиатура, палитра
 * (действие «Спросить MENTAT») и контекстное действие узла карты / «i» показателя — тогда панель
 * открывается с узлом вопроса (`mentatFocus`); экраны не знают о панелях.
 */
import { useSyncExternalStore } from 'react'

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
