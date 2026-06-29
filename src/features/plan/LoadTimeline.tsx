import type { ScheduleResult } from '../../lib/api'

const BINS = 24

/** Цвет ячейки по загрузке: тёмный (простой) → зелёный → янтарь → красный. */
function cellColor(u: number): string {
  if (u < 0.02) return '#171b21'
  const c = Math.min(1, u)
  const hue = 140 - c * 132            // 140° зелёный → 8° красный
  const light = 26 + c * 18
  return `hsl(${hue} 58% ${light}%)`
}

/**
 * Профиль загрузки оборудования ВО ВРЕМЕНИ: тепловая карта «станок × время».
 * Загрузка в бине = доля времени бина, занятая операциями на этом станке (из Gantt).
 */
export function LoadTimeline({ gantt, makespan }: { gantt: ScheduleResult['gantt']; makespan: number }) {
  const span = Math.max(1, makespan)
  const binH = span / BINS

  const rows: { id: string; name: string }[] = []
  const index = new Map<string, number>()
  for (const j of gantt) {
    const id = j.machine_id || 'supply'
    if (!index.has(id)) { index.set(id, rows.length); rows.push({ id, name: j.machine_name || j.wc_name || 'Снабжение' }) }
  }
  const util = rows.map(() => new Array(BINS).fill(0))
  for (const j of gantt) {
    const r = index.get(j.machine_id || 'supply')!
    for (let b = 0; b < BINS; b++) {
      const a = b * binH, c = (b + 1) * binH
      const ov = Math.max(0, Math.min(j.end, c) - Math.max(j.start, a))
      util[r][b] += ov
    }
  }

  if (!rows.length) return <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>Нет данных расписания.</p>

  return (
    <div style={{ fontSize: 11 }}>
      {rows.map((m, r) => (
        <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
          <span style={{ width: 150, flex: '0 0 150px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--text)' }} title={m.name}>{m.name}</span>
          <div style={{ display: 'flex', flex: 1, gap: 1 }}>
            {util[r].map((busy, b) => {
              const u = busy / binH
              return <span key={b} title={`ч ${Math.round(b * binH)}–${Math.round((b + 1) * binH)}: ${Math.round(u * 100)}%`}
                           style={{ flex: 1, height: 14, background: cellColor(u), borderRadius: 1 }} />
            })}
          </div>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 6, marginTop: 6, color: 'var(--text-muted)' }}>
        <span style={{ width: 150, flex: '0 0 150px' }}>станок · время →</span>
        <div style={{ display: 'flex', flex: 1, justifyContent: 'space-between' }}>
          <span>0ч</span><span>{Math.round(span / 2)}ч</span><span>{Math.round(span)}ч</span>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 6, alignItems: 'center', color: 'var(--text-muted)' }}>
        <span>простой</span>
        {[0.1, 0.4, 0.7, 0.95].map((u) => <span key={u} style={{ width: 16, height: 10, background: cellColor(u), borderRadius: 1 }} />)}
        <span>загрузка 100%</span>
      </div>
    </div>
  )
}
