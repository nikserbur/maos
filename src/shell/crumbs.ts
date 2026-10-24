/**
 * Имена объектов для крошек и заголовка вкладки (X2 «одно имя — одна вещь»): экран знает имя
 * открытого объекта («ТК-12 Вал», «Базовый», «План №28 · CR») и сообщает его оболочке; оболочка
 * подставляет его вместо общего «Техкарта». Ключ — путь якоря маршрута (`routing/42`).
 */
import { useSyncExternalStore } from 'react'

let titles: Readonly<Record<string, string>> = {}
const listeners = new Set<() => void>()

function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => { listeners.delete(l) }
}
const snapshot = (): Readonly<Record<string, string>> => titles

/** Экран: «у объекта по адресу `screenId/anchor` такое имя»; пустое имя снимает подпись. */
export function setCrumbTitle(screenId: string, anchor: string, title: string | null | undefined): void {
  const key = `${screenId}/${anchor}`
  const value = title?.trim() || undefined
  if (titles[key] === value) return
  const next = { ...titles }
  if (value === undefined) delete next[key]
  else next[key] = value
  titles = next
  listeners.forEach((l) => l())
}

export function crumbTitle(screenId: string, anchor: string): string | undefined {
  return titles[`${screenId}/${anchor}`]
}

export function useCrumbTitles(): Readonly<Record<string, string>> {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}
