/**
 * Нижний статус-бар (X2 «спокойная норма»): в норме — приглушённое «Сервер: на связи» без цвета;
 * без связи — «■ Нет связи с сервером · Повторить» (цвет только у глифа). Фоновая работа —
 * чип «План: расчёт идёт…» со ссылкой на экран; одно худшее отклонение конвейера («✕ 1 ошибка»,
 * «▲ 2 устарело») ведёт на экран-владелец блока. Пользователь и проект открывают меню учётной записи.
 * Версия — из package.json (__APP_VERSION__).
 */
import { BLOCKS } from '../features/method-map/blocks'
import { liveOf } from '../features/method-map/deriveState'
import type { BlockId } from '../features/method-map/types'
import { useMethodMapState } from '../features/method-map/useMethodMapState'
import { useCashStore } from '../features/finance/cashStore'
import { useOptStore } from '../features/optimization/optStore'
import { usePlanStore } from '../features/plan/planStore'
import { countText } from '../explain/format'
import { AccountMenu } from './AccountMenu'
import { blockHref } from './blockHome'
import { checkHealth, useBackendHealth, type Connection } from './health'
import { PRODUCT_VERSION } from './version'

const CONNECTION: Record<Connection, { glyph: string; label: string }> = {
  checking: { glyph: 'statusbar__dot', label: 'Сервер: подключение…' },
  online: { glyph: 'statusbar__dot', label: 'Сервер: на связи' },
  offline: { glyph: 'glyph-down', label: 'Нет связи с сервером' },
}

interface Job { key: string; text: string; href: string }

/** Фоновые расчёты из хранилищ экранов: идут, даже когда пользователь ушёл на другой экран. */
function useJobs(): Job[] {
  const plan = usePlanStore()
  const opt = useOptStore()
  const cash = useCashStore()
  const jobs: Job[] = []
  if (opt.running) jobs.push({ key: 'opt', text: 'Портфель: расчёт идёт…', href: '#/optimization' })
  if (plan.running) jobs.push({ key: 'plan', text: 'План: расчёт идёт…', href: '#/plan' })
  if (cash.running) jobs.push({ key: 'cash', text: 'Касса: ЛП считается…', href: '#/plan' })
  return jobs
}

interface Worst { kind: 'error' | 'stale'; count: number; block: BlockId }

/** Одно худшее отклонение по блокам конвейера: ошибки важнее «устарело». */
function useWorst(): Worst | null {
  const { state } = useMethodMapState()
  const errors = BLOCKS.filter((b) => liveOf(state, b.id).state === 'error')
  if (errors.length) return { kind: 'error', count: errors.length, block: errors[0].id }
  const stale = BLOCKS.filter((b) => liveOf(state, b.id).state === 'stale')
  if (stale.length) return { kind: 'stale', count: stale.length, block: stale[0].id }
  return null
}

export function StatusBar() {
  const { connection } = useBackendHealth()
  const conn = CONNECTION[connection]
  const jobs = useJobs()
  const worst = useWorst()

  return (
    <footer className="statusbar">
      <span className="statusbar__version num">{PRODUCT_VERSION}</span>
      <span className="statusbar__sep" aria-hidden="true" />
      <span className={`statusbar__conn statusbar__conn--${connection}`} role="status">
        <span className={conn.glyph} aria-hidden="true" />
        {conn.label}
        {connection === 'offline' && (
          <button type="button" className="btn btn--ghost btn--sm statusbar__retry" onClick={checkHealth}>Повторить</button>
        )}
      </span>
      {jobs.map((j) => (
        <a key={j.key} className="statusbar__job" href={j.href} title="Открыть экран расчёта">
          <span className="statusbar__spin" aria-hidden="true" />{j.text}
        </a>
      ))}
      {worst && (
        <a className="statusbar__worst" href={blockHref(worst.block, false) ?? '#/map'}
          title={worst.kind === 'error' ? 'Открыть экран блока с ошибкой' : 'Открыть экран устаревшего блока'}>
          {worst.kind === 'error'
            ? <><span className="glyph-x" aria-hidden="true" />{countText(worst.count, ['ошибка', 'ошибки', 'ошибок'])}</>
            : <><span className="mm-glyph mm-glyph--stale" aria-hidden="true" /> {worst.count} устарело</>}
        </a>
      )}
      <span className="statusbar__spacer" />
      <AccountMenu variant="statusbar" />
    </footer>
  )
}
