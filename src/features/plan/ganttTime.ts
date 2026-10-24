/**
 * Двухуровневая ось Ганта (канон APS): верхний уровень — даты (сутки или месяцы), нижний — смены/часы
 * (или числа месяца при мелком масштабе). От начала горизонта (UTC-полночь сценария); без даты —
 * «сутки N» и часы. Деления выбираются по плотности пикселей, подписи не налезают. Чистые функции.
 */
import { num } from '../../explain/format'

export interface AxisTick {
  t: number
  label: string
  /** Граница верхнего уровня (сутки/месяц) — линия сетки плотнее. */
  major?: boolean
}

export interface AxisLevels {
  top: AxisTick[]
  bottom: AxisTick[]
}

const DAY = 24
const MS_PER_HOUR = 3_600_000
const HOUR_STEPS = [1, 2, 4, 6, 8, 12] as const
const DAY_STEPS = [1, 2, 7, 14] as const
/** Минимальная ширина подписи нижнего уровня, px. */
const MIN_BOTTOM_PX = 34
/** Сутки шире этого — нижний уровень в часах, иначе — в днях. */
const HOURS_MODE_DAY_PX = 96

const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'] as const
const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'] as const
const pad2 = (n: number) => String(n).padStart(2, '0')

const at = (start: Date, h: number): Date => new Date(start.getTime() + h * MS_PER_HOUR)

/** Деления 0…span с шагом step. */
function range(span: number, step: number, from = 0): number[] {
  const out: number[] = []
  for (let t = from; t <= span + 1e-6; t += step) out.push(t)
  return out
}

export function axisLevels(span: number, pxPerHour: number, start: Date | null): AxisLevels {
  const dayPx = pxPerHour * DAY
  if (dayPx >= HOURS_MODE_DAY_PX) {
    const step = HOUR_STEPS.find((h) => h * pxPerHour >= MIN_BOTTOM_PX) ?? 12
    const top = range(span, DAY).map((t) => {
      if (!start) return { t, label: `сутки ${num(t / DAY + 1, 0)}`, major: true }
      const d = at(start, t)
      return { t, label: `${WEEKDAYS[d.getUTCDay()]} ${pad2(d.getUTCDate())}.${pad2(d.getUTCMonth() + 1)}`, major: true }
    })
    const bottom = range(span, step).filter((t) => t % DAY !== 0).map((t) => ({ t, label: start ? `${pad2(at(start, t).getUTCHours())}:00` : `${num(t % DAY, 0)} ч` }))
    return { top, bottom }
  }
  const dayStep = DAY_STEPS.find((n) => n * dayPx >= MIN_BOTTOM_PX) ?? 30
  const bottom = range(span, dayStep * DAY).map((t) => ({
    t, label: start ? pad2(at(start, t).getUTCDate()) : num(t / DAY + 1, 0),
  }))
  if (!start) {
    const weekStep = dayStep >= 7 ? 28 : 7
    const top = range(span, weekStep * DAY).map((t) => ({ t, label: `неделя ${num(t / (7 * DAY) + 1, 0)}`, major: true }))
    return { top, bottom }
  }
  // Верхний уровень — границы месяцев (и начало горизонта).
  const top: AxisTick[] = [{ t: 0, label: monthLabel(start), major: true }]
  const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1))
  while ((d.getTime() - start.getTime()) / MS_PER_HOUR <= span) {
    top.push({ t: (d.getTime() - start.getTime()) / MS_PER_HOUR, label: monthLabel(d), major: true })
    d.setUTCMonth(d.getUTCMonth() + 1)
  }
  return { top, bottom }
}

function monthLabel(d: Date): string {
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

/** Подпись точки времени для подсказок и осей других графиков плана: «пн 02.11 08:00» или «сутки 3, 8 ч». */
export function timeLabel(h: number, start: Date | null): string {
  if (!start) return `сутки ${num(Math.floor(h / DAY) + 1, 0)}, ${num(h % DAY, 0)} ч`
  const d = at(start, h)
  return `${pad2(d.getUTCDate())}.${pad2(d.getUTCMonth() + 1)} ${pad2(d.getUTCHours())}:00`
}

/** Подпись суток для графиков по дням: «02.11» или «сутки 3». */
export function dayLabel(dayIndex: number, start: Date | null): string {
  if (!start) return `сутки ${num(dayIndex + 1, 0)}`
  const d = at(start, dayIndex * DAY)
  return `${pad2(d.getUTCDate())}.${pad2(d.getUTCMonth() + 1)}`
}
