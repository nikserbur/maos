/**
 * Запись журнала в боковой панели (X2 P-133 «детали — ключ — значение, не JSON»): только просмотр,
 * список остаётся видимым; объект — ссылкой туда, где он правится.
 */
import { dateTime } from '../../explain/format'
import { SidePanel } from '../../ui/kit'
import { actionLabel, payloadEntries, type NameIndex } from './auditVocabulary'
import { ActionCell, ObjectCell, type LogRow } from './AuditLog'

interface AuditEntryPanelProps {
  row: LogRow
  names: NameIndex
  onClose: () => void
}

export function AuditEntryPanel({ row, names, onClose }: AuditEntryPanelProps) {
  const entries = payloadEntries(row.p, names)
  const title = `${actionLabel(row.a.action_type)} · ${row.obj.label}`
  return (
    <SidePanel title={title.charAt(0).toUpperCase() + title.slice(1)} onClose={onClose} className="adm__side-panel">
      <dl className="adm__kv">
        <div className="adm__kv-row"><dt>Когда</dt><dd className="adm__kv-num">{dateTime(row.a.ts)}</dd></div>
        <div className="adm__kv-row"><dt>Кто</dt><dd>{row.who}</dd></div>
        <div className="adm__kv-row"><dt>Действие</dt><dd><ActionCell code={row.a.action_type} /></dd></div>
        <div className="adm__kv-row"><dt>Объект</dt><dd><ObjectCell obj={row.obj} /></dd></div>
        {row.summary && <div className="adm__kv-row"><dt>Подробности</dt><dd>{row.summary}</dd></div>}
      </dl>
      <h3 className="adm__kv-title">Снимок записи</h3>
      {entries.length > 0 ? (
        <dl className="adm__kv adm__kv--snap">
          {entries.map((e) => (
            <div className="adm__kv-row" key={e.key}>
              <dt>{e.label}</dt>
              <dd>{e.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="adm__muted">Сервер не сохранил подробностей для этого действия.</p>
      )}
    </SidePanel>
  )
}
