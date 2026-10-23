/**
 * Единый ползунок α (UX-V2 §4.10, §6.2): это `ParamField` для паспорта `scenario.alpha` — значение
 * живёт в сценарии, «Портфель», «План», «Касса», карта и агент читают его же. Подпись всегда
 * переводит α в слова: «хвост = худшие 10 % из 3 000 сценариев». Презентационный: значение,
 * сохранение и сценарий передаёт контейнер (useScenarioAlpha).
 */
import { num } from '../explain/format'
import { ParamField } from './ParamField'
import { Chip } from './kit'

export type AlphaSaveState = 'idle' | 'pending' | 'saved' | 'error'

interface AlphaSliderProps {
  /** Доля 0,01…0,5. */
  alpha: number
  onChange: (alpha: number) => void
  scenarioName: string | null
  /** Сколько сценариев в хвостовой оценке (для слов «худшие n %»). */
  nScenarios?: number
  /** Статус паспорта r1.19 ([К] по умолчанию). */
  status?: string
  save?: AlphaSaveState
  disabled?: boolean
}

const SAVE_TEXT: Readonly<Record<AlphaSaveState, string>> = { idle: '', pending: 'сохраняем в сценарий…', saved: 'сохранено в сценарии', error: 'не сохранилось — сервер недоступен' }

/** «худшие 10 % из 3 000 сценариев (300 худших)». */
export function alphaWords(alpha: number, n?: number): string {
  const share = `худшие ${num(alpha * 100, 0)} %`
  if (!n || n <= 0) return `хвост = ${share} сценариев`
  return `хвост = ${share} из ${num(n, 0)} сценариев (${num(Math.max(1, Math.round(alpha * n)), 0)} худших)`
}

export function AlphaSlider({ alpha, onChange, scenarioName, nScenarios, status = 'К', save = 'idle', disabled = false }: AlphaSliderProps) {
  return (
    <ParamField
      label="α хвоста — один на все экраны"
      value={Math.round(alpha * 100)}
      unit="%"
      status={status}
      provenance="calibrated"
      owner={scenarioName ? `из сценария «${scenarioName}»` : 'сценарий не выбран — значение по умолчанию'}
      range={[1, 50]}
      step={1}
      min={1}
      max={50}
      slider={!disabled}
      readOnly={disabled}
      onChange={disabled ? undefined : (v) => onChange(v / 100)}
      info="opt.cvar"
      infoValues={{ alpha }}
      note={<>{alphaWords(alpha, nScenarios)}{save !== 'idle' && <> · <Chip size="sm" tone={save === 'error' ? 'bad' : save === 'saved' ? 'good' : 'idle'}>{SAVE_TEXT[save]}</Chip></>}</>}
    />
  )
}
