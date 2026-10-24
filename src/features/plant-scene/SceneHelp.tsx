/**
 * «?» «Управление» (X2 P-33) — вместо постоянной подсказки поверх канваса: поповер с клавишами и
 * жестами схемы. Тот же поповер, что у «i» (Esc, клик снаружи, возврат фокуса).
 */
import { useCallback, useId, useRef, useState } from 'react'
import { InfoTipPopover } from '../../ui/InfoTip'
import type { SceneLevel } from './InspectorEmpty'

const KEYS_3D: ReadonlyArray<[string, string]> = [
  ['ЛКМ', 'выбрать объект'],
  ['2×ЛКМ', 'войти внутрь цеха или завода'],
  ['Колесо', 'приблизить / отдалить'],
  ['ПКМ + движение', 'сдвинуть вид'],
  ['ЛКМ + движение', 'повернуть вид'],
  ['F', 'вписать уровень в кадр'],
  ['Esc', 'снять выбор, затем уровень выше'],
]

const KEYS_WORLD: ReadonlyArray<[string, string]> = [
  ['ЛКМ', 'выбрать предприятие'],
  ['2×ЛКМ или Shift+Enter', 'войти на площадку'],
  ['Колесо', 'масштаб карты'],
  ['Перетаскивание', 'сдвинуть карту'],
  ['Tab, Enter', 'перейти к пину и выбрать его'],
  ['Esc', 'снять выбор'],
]

export function SceneHelp({ level }: { level: SceneLevel }) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const popId = useId()
  const titleId = `${popId}-title`
  const close = useCallback((returnFocus: boolean) => {
    setOpen(false)
    if (returnFocus) triggerRef.current?.focus()
  }, [])
  const keys = level === 'world' ? KEYS_WORLD : KEYS_3D
  return (
    <>
      <button ref={triggerRef} type="button" className="btn btn--ghost btn--sm btn--icon scene-help__btn"
              aria-label="Управление" title="Управление" aria-haspopup="dialog" aria-expanded={open}
              aria-controls={open ? popId : undefined} onClick={() => (open ? close(true) : setOpen(true))}>
        <span aria-hidden="true">?</span>
      </button>
      {open && (
        <InfoTipPopover anchor={triggerRef.current} placement="bottom-end" popId={popId} titleId={titleId} onClose={close}>
          <div className="infotip-pop__panel">
            <header className="infotip-pop__head">
              <h3 id={titleId} className="infotip-pop__title">Управление</h3>
            </header>
            <dl className="scene-help__keys">
              {keys.map(([k, v]) => (
                <div key={k}><dt><kbd>{k}</kbd></dt><dd>{v}</dd></div>
              ))}
            </dl>
          </div>
        </InfoTipPopover>
      )}
    </>
  )
}
