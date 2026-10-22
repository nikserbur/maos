/**
 * Регистрация объекта схемы в НСИ (режим редактирования, узел без привязанной машины):
 * название, тип оборудования (= 3D-вид), цех по контексту, статус.
 */
import { useEffect, useState } from 'react'
import { ErrorBanner } from '../../ui/kit'
import type { ObjectKind } from './types'
import type { SceneNode } from './graph/sceneModel'
import { KIND_META, PALETTE } from './graph/sceneModel'
import type { WorkCenterType } from '../../lib/api'

export interface MachineCreateData {
  name: string
  wcTypeId: string
  orgUnit: string
  status: string
  kind: ObjectKind
}

interface RegisterFormProps {
  node: SceneNode
  wcTypes: WorkCenterType[]
  currentShopName: string | null
  onCreate: (nodeId: string, data: MachineCreateData) => Promise<void>
  onChangeKind: (nodeId: string, kind: ObjectKind) => void
}

export function RegisterForm({ node, wcTypes, currentShopName, onCreate, onChangeKind }: RegisterFormProps) {
  const [name, setName] = useState(node.title)
  const [kind, setKind] = useState<ObjectKind>(node.kind)
  const [wcType, setWcType] = useState('')
  const [status, setStatus] = useState('active')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Форма сбрасывается при смене выбранного узла.
  useEffect(() => {
    setName(node.title); setKind(node.kind); setWcType(''); setStatus('active'); setError(null)
  }, [node.id, node.title, node.kind])

  // 3D-вид объекта = вид его ТИПА оборудования: при выборе типа модель на схеме
  // подстраивается под тип (объект на схеме и тип оборудования — одно и то же).
  const selectWcType = (typeId: string) => {
    setWcType(typeId)
    const t = wcTypes.find((x) => x.id === typeId)
    if (t && (PALETTE as string[]).includes(t.kind)) {
      setKind(t.kind as ObjectKind)
      onChangeKind(node.id, t.kind as ObjectKind)
    }
  }

  const submit = async () => {
    if (!name.trim()) { setError('Укажите название'); return }
    // Станок без типа не связывается с операциями техкарт → «оборудование без операций».
    if (!wcType) { setError('Выберите тип оборудования — без типа станок не получит операций из техкарт'); return }
    setBusy(true)
    setError(null)
    try {
      await onCreate(node.id, { name, wcTypeId: wcType, orgUnit: '', status, kind })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка сохранения')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ep-register">
      <p className="ep-register__hint">Объект не зарегистрирован. Заполните данные и нажмите «Зарегистрировать».</p>
      {error && <ErrorBanner tone="setup" message={error} />}

      <label className="ep-register__label text-caps" htmlFor="ep-reg-name">Наименование *</label>
      <input id="ep-reg-name" className="ep-register__input" value={name}
             onChange={(e) => setName(e.target.value)} placeholder="Название единицы оборудования" />

      <label className="ep-register__label text-caps" htmlFor="ep-reg-type">Тип оборудования (= 3D-вид)</label>
      <select id="ep-reg-type" className="ep-register__select" value={wcType} onChange={(e) => selectWcType(e.target.value)}>
        <option value="">— выберите тип —</option>
        {wcTypes.map((t) => (
          <option key={t.id} value={t.id}>{t.name} — {KIND_META[t.kind as ObjectKind]?.label ?? t.kind}</option>
        ))}
      </select>
      {wcTypes.length === 0 && (
        <p className="ep-register__hint editor-panel__tip--warn">
          <span className="glyph-setup" aria-hidden="true" />
          Типов оборудования ещё нет — станок нельзя привязать к операциям техкарт. Откройте
          <b> Справочники → Типы оборудования</b>, создайте тип (например «Токарный станок ЧПУ»),
          затем вернитесь и выберите его здесь.
        </p>
      )}
      {wcType && (
        <p className="ep-register__hint">3D-модель: {KIND_META[kind]?.label ?? kind} (по типу оборудования).</p>
      )}

      <span className="ep-register__label text-caps">Цех (по контексту)</span>
      <div className="ep-register__static">{currentShopName ?? '— вне цеха —'}</div>

      <label className="ep-register__label text-caps" htmlFor="ep-reg-status">Статус</label>
      <select id="ep-reg-status" className="ep-register__select" value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="active">В работе</option>
        <option value="maintenance">Техобслуживание</option>
        <option value="decommissioned">Выведено из эксплуатации</option>
      </select>

      <button type="button" className="btn btn--primary ep-register__submit" onClick={submit} disabled={busy}>
        {busy ? 'Сохраняем…' : 'Зарегистрировать в НСИ'}
      </button>
    </div>
  )
}
