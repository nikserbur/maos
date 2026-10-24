/**
 * Редактор распределения цены изделия в боковой панели кита (X2 «записи правятся рядом со списком»):
 * таблица остаётся видимой, панель липнет под вкладками. Правка — черновик: «Отмена» / «Сохранить
 * изменения», страж несохранённого (SidePanel), Esc закрывает и возвращает фокус на строку.
 * Плотность-миниатюра рисуется по черновику — видно, что изменится, до сохранения.
 */
import { useEffect, useState } from 'react'
import type { DistType, PriceDistribution } from '../../lib/api'
import { money, num, pct } from '../../explain/format'
import { DIST_TYPE_LABEL, DensityMini } from '../../ui/DensityMini'
import { SidePanel } from '../../ui/kit'
import { BETA_DEFAULT, SIGMA_DEFAULT, type DistRow } from './distModel'

const TYPES: readonly DistType[] = ['normal', 'lognormal', 't', 'pareto', 'triangular', 'uniform']

interface Draft { dist_type: DistType; mean: string; stddev: string; min_val: string; max_val: string; beta: string }

const str = (v: number | string | undefined | null): string => (v === undefined || v === null ? '' : String(v))

function draftOf(r: DistRow): Draft {
  return {
    dist_type: r.type, mean: str(r.center), stddev: str(r.sd), min_val: str(r.d?.min_val), max_val: str(r.d?.max_val), beta: str(r.beta),
  }
}

const sameDraft = (a: Draft, b: Draft): boolean => (Object.keys(a) as Array<keyof Draft>).every((k) => a[k] === b[k])

interface Props {
  row: DistRow
  onSave: (patch: Partial<PriceDistribution>) => Promise<void>
  onClose: () => void
  onDirtyChange?: (dirty: boolean) => void
}

export function DistributionEditor({ row, onSave, onClose, onDirtyChange }: Props) {
  const initial = draftOf(row)
  const [draft, setDraft] = useState<Draft>(initial)
  const [saving, setSaving] = useState(false)
  const dirty = !sameDraft(draft, initial)
  useEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])

  const set = (k: keyof Draft) => (v: string) => setDraft((d) => ({ ...d, [k]: v }))
  const center = Number(draft.mean) || row.base
  const sd = Number(draft.stddev)
  const rel = center > 0 && Number.isFinite(sd) ? sd / center : SIGMA_DEFAULT

  const save = async () => {
    setSaving(true)
    await onSave({ ...draft, beta: draft.beta === '' ? BETA_DEFAULT : draft.beta })
    setSaving(false)
    onClose()
  }
  const reset = () => setDraft({
    dist_type: 'normal', mean: str(row.base), stddev: str(Math.round(row.base * SIGMA_DEFAULT)), min_val: '', max_val: '', beta: str(BETA_DEFAULT),
  })

  return (
    <SidePanel className="sc2-side" title={row.p.name} onClose={onClose} onSave={() => { void save() }} dirty={dirty} saving={saving}
      menu={[{ id: 'reset', label: 'Вернуть умолчание', icon: 'rewind', onSelect: reset, hint: `нормальное, разброс ${pct(SIGMA_DEFAULT, 0)}, β ${num(BETA_DEFAULT, 1)}` }]}>
      <div className="sc2-editor">
        <p className="sc2-muted">{row.p.code}{row.raw ? ' · сырьё, закупочная цена' : ' · цена сбыта'} · база справочника {money(row.base)}</p>
        <DensityMini type={draft.dist_type} rel={rel} width={300} height={64} label={`Плотность: ${DIST_TYPE_LABEL[draft.dist_type]}, разброс ${pct(rel, 0)}`} />
        <label className="sc2-editor__f">Распределение
          <select className="form__select" value={draft.dist_type} onChange={(e) => set('dist_type')(e.target.value as DistType)}>
            {TYPES.map((t) => <option key={t} value={t}>{DIST_TYPE_LABEL[t]}</option>)}
          </select>
        </label>
        <label className="sc2-editor__f">Центр, ₽
          <input className="form__input num" type="number" value={draft.mean} onChange={(e) => set('mean')(e.target.value)} />
        </label>
        <label className="sc2-editor__f">Разброс σ, ₽ <span className="sc2-muted num">{pct(rel, 1)} центра</span>
          <input className="form__input num" type="number" min={0} value={draft.stddev} onChange={(e) => set('stddev')(e.target.value)} />
        </label>
        <div className="sc2-editor__pair">
          <label className="sc2-editor__f">Минимум, ₽
            <input className="form__input num" type="number" value={draft.min_val} placeholder="без границы" onChange={(e) => set('min_val')(e.target.value)} />
          </label>
          <label className="sc2-editor__f">Максимум, ₽
            <input className="form__input num" type="number" value={draft.max_val} placeholder="без границы" onChange={(e) => set('max_val')(e.target.value)} />
          </label>
        </div>
        <label className="sc2-editor__f">Связь с рынком β <span className="sc2-muted">0 — независимо, 1 — вместе с рынком</span>
          <input className="form__input num" type="number" min={0} max={1.5} step={0.05} value={draft.beta} onChange={(e) => set('beta')(e.target.value)} />
        </label>
      </div>
    </SidePanel>
  )
}
