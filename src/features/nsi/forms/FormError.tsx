/**
 * Ошибка формы НСИ: строка проверки — коротко над полями; ошибка сервера — простыми словами
 * (errorText) с сырым текстом под «Подробнее»; «Изменений нет» — нейтральный статус, не ошибка.
 */
import { ErrorBanner } from '../../../ui/kit'

export function FormError({ error }: { error: unknown }) {
  if (error === null || error === undefined || error === '') return null
  if (typeof error === 'string') return <div className="form__error" role="alert">{error}</div>
  return <ErrorBanner error={error} />
}

export function FormNote({ text }: { text: string | null }) {
  return text ? <p className="nsi-form-note" role="status">{text}</p> : null
}

export const NO_CHANGES = 'Изменений нет — сохранять нечего'
