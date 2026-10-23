/**
 * Глобальные панели оболочки (UX-V2 §7 G4): командная палитра (Cmd/Ctrl+K) и боковая панель
 * MENTAT. Одно маленькое хранилище: открывает верхняя панель, клавиатура и сама палитра
 * (действие «Спросить MENTAT»); экраны не знают о панелях.
 */
import { useSyncExternalStore } from 'react'

export interface Overlays { palette: boolean; mentat: boolean }

let state: Overlays = { palette: false, mentat: false }
const listeners = new Set<() => void>()

function commit(next: Overlays): void {
  if (next.palette === state.palette && next.mentat === state.mentat) return
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
  openMentat: () => commit({ palette: false, mentat: true }),
  closeMentat: () => commit({ ...state, mentat: false }),
  toggleMentat: () => commit({ ...state, mentat: !state.mentat }),
}
