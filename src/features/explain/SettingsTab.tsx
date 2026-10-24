/**
 * Подключение локальной модели: статус (задана ли, откуда адрес, отвечает ли, какие модели есть), форма
 * настроек проекта (вид API, адрес, модель, температура, лимиты, примеры, аудит ответов) и «Проверить
 * соединение». Ключ API и разрешённые нелокальные хосты задаются только переменными окружения сервера.
 */
import { useEffect, useId, useState } from 'react'
import { num } from '../../explain/format'
import { can } from '../../shell/session'
import { Chip, ErrorBanner, IconButton, Segmented, Switch } from '../../ui/kit'
import { mentatApi, type MentatStatus } from './llm/mentatApi'
import { FLAVOURS, LIMITS, chatEndpoint, checkBaseUrl, normalizeSettings, type LlmFlavour, type LlmSettings } from './llm/settings'
import type { MentatStatusState } from './useMentat'

function StatusLine({ s, probing }: { s: MentatStatus; probing: boolean }) {
  if (!s.configured) {
    return <p className="mt-status"><Chip tone="idle">не подключена</Chip> {s.error || 'адрес модели не задан'}</p>
  }
  const reach = s.reachable === null ? <Chip tone="info">не проверялась</Chip>
    : s.reachable ? <Chip tone="good">отвечает</Chip> : <Chip tone="bad">не отвечает</Chip>
  return (
    <p className="mt-status">
      {probing ? <Chip tone="setup">проверяем…</Chip> : reach} <span className="mono">{s.model}</span> · {s.flavour === 'ollama' ? 'Ollama' : 'OpenAI-совместимый'} · адрес из {s.source === 'env' ? 'окружения сервера' : 'настроек проекта'}
      {s.error && <span className="mt-status__err"> — {s.error}</span>}
    </p>
  )
}

type NumKey = keyof typeof LIMITS

export function SettingsTab({ st }: { st: MentatStatusState }) {
  const id = useId()
  const [form, setForm] = useState<LlmSettings>(() => normalizeSettings(st.status?.settings))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  useEffect(() => { if (st.status) setForm(normalizeSettings(st.status.settings)) }, [st.status])

  const canEdit = can('EDIT_NSI')
  const locked = Boolean(st.status?.env_locked)
  const check = checkBaseUrl(form.base_url)
  const set = <K extends keyof LlmSettings>(k: K, v: LlmSettings[K]) => { setSaved(false); setForm((f) => ({ ...f, [k]: v })) }
  const setNum = (k: NumKey, raw: string) => set(k, Number(raw.replace(',', '.')))
  const save = async () => {
    setSaving(true); setError(null)
    try {
      st.replace(await mentatApi.saveSettings(normalizeSettings(form)))
      setSaved(true)
    } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось сохранить настройки') } finally { setSaving(false) }
  }
  const numField = (k: NumKey, label: string, step: number) => (
    <label className="form__field" htmlFor={`${id}-${k}`}>
      <span className="form__label">{label}</span>
      <input id={`${id}-${k}`} className="form__input" type="number" min={LIMITS[k][0]} max={LIMITS[k][1]} step={step}
        value={form[k]} disabled={!canEdit} onChange={(e) => setNum(k, e.target.value)} />
      <span className="form__hint">{num(LIMITS[k][0])} … {num(LIMITS[k][1])}</span>
    </label>
  )

  return (
    <div className="mt-settings">
      {st.status ? <StatusLine s={st.status} probing={st.probing} /> : st.error && <ErrorBanner title="MENTAT-API недоступен" message={st.error} onRetry={() => { void st.refresh(false) }} />}
      <div className="mt-row">
        <IconButton icon="play" onClick={() => { void st.refresh(true) }} disabled={st.probing || !st.status?.configured} title="Запросить у модели список моделей (5 с)">Проверить соединение</IconButton>
      </div>
      {st.status?.models.length ? <p className="mt-muted">Модели на сервере: <span className="mono">{st.status.models.join(', ')}</span></p> : null}
      {locked && <p className="mt-note" role="note">Адрес и модель заданы переменными окружения сервера (MAOS_LLM_URL, MAOS_LLM_MODEL) — поля ниже их не меняют.</p>}
      {!canEdit && <p className="mt-note" role="note">Менять подключение может роль с правом EDIT_NSI; вам доступен просмотр.</p>}

      <form className="form mt-form" onSubmit={(e) => { e.preventDefault(); void save() }}>
        <div className="form__field">
          <span className="form__label">Вид API</span>
          <Segmented<LlmFlavour> options={FLAVOURS.map((f) => ({ id: f.id, label: f.label, title: f.endpoint, disabled: !canEdit }))}
            value={form.flavour} onChange={(v) => set('flavour', v)} label="Вид API локальной модели" size="sm" />
        </div>
        <label className="form__field" htmlFor={`${id}-url`}>
          <span className="form__label">Адрес модели</span>
          <input id={`${id}-url`} className="form__input mono" type="url" inputMode="url" autoComplete="off" spellCheck={false}
            placeholder={FLAVOURS.find((f) => f.id === form.flavour)?.example} value={form.base_url} disabled={!canEdit || locked}
            aria-invalid={!check.ok} onChange={(e) => set('base_url', e.target.value)} />
          <span className={check.ok ? 'form__hint' : 'form__error'}>
            {check.message ?? (form.base_url ? `Запрос пойдёт на ${chatEndpoint(form)}` : 'Пусто — модель не подключена')}
          </span>
        </label>
        <label className="form__field" htmlFor={`${id}-model`}>
          <span className="form__label">Модель</span>
          <input id={`${id}-model`} className="form__input mono" list={`${id}-models`} autoComplete="off" spellCheck={false}
            placeholder="qwen2.5:14b-instruct" value={form.model} disabled={!canEdit || locked} onChange={(e) => set('model', e.target.value)} />
          <datalist id={`${id}-models`}>{st.status?.models.map((m) => <option key={m} value={m} />)}</datalist>
        </label>
        <div className="form__row">
          {numField('temperature', 'Температура', 0.01)}
          {numField('max_tokens', 'Макс. токенов ответа', 1)}
        </div>
        <div className="form__row">
          {numField('timeout_s', 'Таймаут, с', 1)}
          {numField('context_tokens', 'Бюджет контекста, токенов', 1)}
        </div>
        <Switch checked={form.with_examples} onChange={(v) => set('with_examples', v)} hint="Два примера формата ответа в запросе (≈ 1,5 тыс. токенов)">Примеры few-shot в запросе</Switch>
        <Switch checked={form.audit_answers} onChange={(v) => set('audit_answers', v)} hint="Иначе в журнал пишутся только вопрос, узел, версия промпта и итог">Писать текст ответа в журнал аудита</Switch>
        {error && <ErrorBanner title="Настройки не сохранены" message={error} onDismiss={() => setError(null)} />}
        <div className="mt-row">
          <button type="submit" className="btn btn--primary" disabled={!canEdit || saving || !check.ok}>{saving ? 'Сохраняем…' : 'Сохранить'}</button>
          {saved && <span className="mt-muted" role="status">Сохранено в настройках проекта</span>}
        </div>
      </form>
      <p className="mt-muted">Ключ API (если нужен серверу модели) — только переменная окружения MAOS_LLM_API_KEY; нелокальные хосты — MAOS_LLM_ALLOWED_HOSTS. Подробнее — docs/MENTAT.md.</p>
    </div>
  )
}
