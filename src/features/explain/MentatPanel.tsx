/**
 * Панель MENTAT (UX-V2 §7 G4, блок [8]) — заготовка: локальная LLM будет подключена позже, поэтому
 * ответов нет и они не имитируются. Что есть уже сейчас — «что спросить» (шаблоны под экран) и путь
 * объяснения по графу расчёта (explainPath): от результата против рёбер к входам и параметрам,
 * каждый шаг — ссылка на узел карты. Ровно этот путь LLM и будет пересказывать.
 */
import { useEffect, useState } from 'react'
import { Icon } from '../../shell/icons'
import { Chip } from '../../ui/kit'
import { blockTag } from '../method-map/blocks'
import { getNode } from '../method-map/registry'
import { explainPath, templatesFor, type ExplainStep } from './explainPath'
import './mentat.css'

const KIND_LABEL: Readonly<Record<ExplainStep['kind'], string>> = {
  block: 'блок', subblock: 'подблок', parameter: 'параметр', formula: 'формула', dataset: 'датасет', screen: 'экран',
}

interface Props {
  screenId: string
  onClose: () => void
}

export function MentatPanel({ screenId, onClose }: Props) {
  const templates = templatesFor(screenId)
  const [picked, setPicked] = useState<string | null>(null)
  const tpl = templates.find((t) => t.id === picked) ?? null
  const steps = tpl ? explainPath(tpl.target) : []
  const maxDepth = steps.reduce((m, s) => Math.max(m, s.depth), 0)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <aside className="mt" aria-labelledby="mt-title">
      <header className="mt-head">
        <div>
          <p className="text-caps mt-eyebrow">[8] LLM · объяснение по графу</p>
          <h2 className="mt-title" id="mt-title">MENTAT · почему так</h2>
        </div>
        <button type="button" className="btn btn--ghost btn--icon" onClick={onClose} aria-label="Закрыть панель MENTAT" title="Закрыть (Esc)">
          <Icon name="close" size={16} />
        </button>
      </header>

      <div className="mt-honest" role="note">
        <Chip tone="idle">заготовка</Chip>
        <p>Локальная LLM будет подключена позже — ответов здесь нет и они не имитируются. Уже сейчас видно, <b>по какому пути</b> по карте она будет объяснять.</p>
      </div>

      <p className="text-caps mt-h">Что спросить на этом экране</p>
      <ul className="mt-tpl" aria-label="Шаблоны вопросов">
        {templates.map((t) => (
          <li key={t.id}>
            <button type="button" className={`mt-tpl__q${picked === t.id ? ' is-on' : ''}`} aria-pressed={picked === t.id} onClick={() => setPicked(picked === t.id ? null : t.id)}>
              {t.question}
              <span className="mt-tpl__node mono">{getNode(t.target)?.title ?? t.target}</span>
            </button>
          </li>
        ))}
      </ul>

      {tpl && (
        <section className="mt-path" aria-label={`Путь объяснения: ${tpl.question}`}>
          <p className="text-caps mt-h">Путь объяснения · {steps.length} узлов · глубина {maxDepth}</p>
          <ol className="mt-steps">
            {steps.map((s) => (
              <li key={s.id} className={`mt-step mt-step--d${Math.min(s.depth, 4)}`}>
                <a className="mt-step__a" href={`#/map/${s.id}`}>
                  <span className="mt-step__tag mono">{blockTag(getNode(s.id)?.block ?? 'llm')}</span>
                  <span className="mt-step__t">{s.title}</span>
                  <span className="mt-step__k">{KIND_LABEL[s.kind]}</span>
                </a>
                {s.via && <span className="mt-step__via">→ {s.via.label} ({s.via.kind})</span>}
              </li>
            ))}
          </ol>
        </section>
      )}

      <label className="mt-ask">
        <span className="text-caps mt-h">Свой вопрос</span>
        <textarea rows={2} disabled placeholder="Появится после подключения локальной LLM (MENTAT-API)" />
      </label>
    </aside>
  )
}
