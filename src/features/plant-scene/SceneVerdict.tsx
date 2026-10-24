/**
 * Строка-вердикт схемы (X2 P-27, «ответ первым»): «План №28 · узкое место ▲ Резьбонарезной 94 % ·
 * в ТО 2 станка». Без плана — следующий шаг конвейера («Построить план →»), без сервера — честное
 * «недоступно», а не нули.
 */
import { countText } from '../../explain/format'
import { bottleneckText, planHref, planTitle } from './sceneOps'
import type { SceneOpsState } from './useSceneOps'

const MACHINE_FORMS = ['станок', 'станка', 'станков'] as const

export function SceneVerdict({ ops }: { ops: SceneOpsState }) {
  const src = ops.source
  const bottleneck = src ? bottleneckText(src) : null
  const maintenance = ops.maintenance > 0
    ? <span className="scene__verdict-part"><span className="glyph-setup" aria-hidden="true" />в ТО {countText(ops.maintenance, MACHINE_FORMS)}</span>
    : null
  if (!src) {
    return (
      <>
        {ops.loading ? <span className="scene__verdict-part">Загрузка плана…</span>
          : ops.error ? <span className="scene__verdict-part">История планов недоступна — загрузка не показана</span>
            : <span className="scene__verdict-part">Плана ещё нет — загрузка не рассчитана · <a href="#/plan/new">Построить план →</a></span>}
        {maintenance && <><span className="scene__verdict-dot" aria-hidden="true">·</span>{maintenance}</>}
      </>
    )
  }
  return (
    <>
      <a className="scene__verdict-plan" href={planHref(src)} title="Открыть план">{planTitle(src)}</a>
      {bottleneck && (
        <>
          <span className="scene__verdict-dot" aria-hidden="true">·</span>
          <span className="scene__verdict-part">узкое место <span className="glyph-setup" role="img" aria-label="внимание" /> {bottleneck}</span>
        </>
      )}
      {maintenance && <><span className="scene__verdict-dot" aria-hidden="true">·</span>{maintenance}</>}
    </>
  )
}
