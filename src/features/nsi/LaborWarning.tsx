import { useEffect, useState } from 'react'
import { api, type Machine, type Worker, type WorkCenterType } from '../../lib/api'
import { laborBottlenecks, type LaborLoad } from './labor'

/**
 * Предупреждение «не хватает операторов»: по каждому типу РЦ сравнивает число
 * станков с числом допущенных рабочих. Если рабочих меньше — лишние станки
 * простаивают в ожидании оператора (параллелизм ограничен числом операторов).
 * Тихо ничего не рисует, если узких мест по труду нет.
 */
export function LaborWarning({ compact = false }: { compact?: boolean }) {
  const [rows, setRows] = useState<LaborLoad[] | null>(null)

  useEffect(() => {
    Promise.all([
      api.machines.list().catch(() => [] as Machine[]),
      api.workers.list().catch(() => [] as Worker[]),
      api.workCenterTypes.list().catch(() => [] as WorkCenterType[]),
    ]).then(([m, w, t]) => setRows(laborBottlenecks(m, w, t)))
  }, [])

  if (!rows || rows.length === 0) return null

  return (
    <div style={{
      padding: compact ? '9px 11px' : '11px 14px', borderRadius: compact ? 10 : 12,
      background: 'color-mix(in srgb, var(--intent-warning, #d9822b) 12%, var(--bg-card, #12161c))',
      border: '1px solid color-mix(in srgb, var(--intent-warning, #d9822b) 55%, transparent)',
      fontSize: compact ? 12 : 12.5,
    }}>
      <b style={{ color: 'var(--intent-warning, #d9822b)' }}>⚠ Не хватает операторов</b>
      <p style={{ margin: '3px 0 6px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
        Станки этих типов не смогут работать все сразу — параллелизм ограничен числом
        допущенных рабочих. Добавьте операторам допуск (реестр «Рабочие» → галочки допусков)
        или введите новых.
      </p>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: compact ? 11 : 11.5 }}>
        <thead>
          <tr style={{ color: 'var(--text-muted)', textAlign: 'left' }}>
            <th style={{ padding: '2px 4px' }}>Тип оборудования</th>
            <th style={{ padding: '2px 4px', textAlign: 'center' }}>Станков</th>
            <th style={{ padding: '2px 4px', textAlign: 'center' }}>Операторов</th>
            <th style={{ padding: '2px 4px', textAlign: 'center' }}>Параллельно</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((l) => (
            <tr key={l.typeId} style={{ borderTop: '1px solid var(--border)' }}>
              <td style={{ padding: '3px 4px' }}>{l.typeName}</td>
              <td style={{ padding: '3px 4px', textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{l.machines}</td>
              <td style={{ padding: '3px 4px', textAlign: 'center', color: 'var(--intent-danger)', fontVariantNumeric: 'tabular-nums' }}>{l.operators}</td>
              <td style={{ padding: '3px 4px', textAlign: 'center', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                {l.cap} из {l.machines}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
