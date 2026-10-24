/**
 * Подпись в капителях без порчи греческих букв (X1 §7): «σ прибыли» → «σ ПРИБЫЛИ», а не «Σ ПРИБЫЛИ».
 * Греческие фрагменты получают `.no-caps`; остальной текст — как есть (капители задаёт контейнер).
 */
import { Fragment, type ReactNode } from 'react'
import { splitGreek } from '../labelParts'

interface CapsLabelProps {
  text: string
  className?: string
}

export function CapsLabel({ text, className }: CapsLabelProps) {
  const parts = splitGreek(text)
  const body = parts.map((p, i) => (p.greek ? <span key={i} className="no-caps">{p.text}</span> : <Fragment key={i}>{p.text}</Fragment>))
  return className ? <span className={className}>{body}</span> : <>{body}</>
}

/** Узел подписи: строка — через CapsLabel, готовый узел — как есть. */
export function capsNode(label: ReactNode): ReactNode {
  return typeof label === 'string' ? <CapsLabel text={label} /> : label
}
