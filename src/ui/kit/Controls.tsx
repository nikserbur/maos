/**
 * Мелкие контролы кита: переключатель (switch) и кнопка с иконкой вместо эмодзи.
 */
import type { ReactNode } from 'react'
import { Icon, type IconName } from '../../shell/icons'
import './kit.css'

interface SwitchProps {
  checked: boolean
  onChange: (on: boolean) => void
  children: ReactNode
  hint?: string
}

export function Switch({ checked, onChange, children, hint }: SwitchProps) {
  return (
    <label className="dk-switch" title={hint}>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="dk-switch__track" aria-hidden="true"><span className="dk-switch__knob" /></span>
      <span className="dk-switch__label">{children}</span>
    </label>
  )
}

interface IconButtonProps {
  icon: IconName | (string & {})
  children?: ReactNode
  onClick: () => void
  disabled?: boolean
  variant?: 'primary' | 'danger' | 'ghost'
  size?: 'sm' | 'md'
  title?: string
  /** Нажатое состояние (кнопка-переключатель). */
  pressed?: boolean
}

/** Кнопка с иконкой и подписью; без подписи — квадратная с aria-label из title. */
export function IconButton({ icon, children, onClick, disabled, variant, size = 'md', title, pressed }: IconButtonProps) {
  const cls = ['btn', variant ? `btn--${variant}` : '', children ? '' : 'btn--icon', size === 'sm' ? 'btn--sm' : ''].filter(Boolean).join(' ')
  return (
    <button type="button" className={cls} onClick={onClick} disabled={disabled} title={title}
            aria-label={children ? undefined : title} aria-pressed={pressed}>
      <Icon name={icon} size={14} />
      {children}
    </button>
  )
}
