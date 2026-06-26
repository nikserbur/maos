import type { FlowLink, PlantStage } from './types'

/**
 * Демонстрационная схема предприятия: линия глубокой переработки лигнина
 * (брикеты/пеллеты). Данные статичны — на следующих фазах их источником
 * станут НСИ и результаты планировщика. Масштабы моделей подобраны под
 * исходные пропорции, координаты [x, z] задают раскладку на полу.
 */
export const STAGES: PlantStage[] = [
  {
    id: 'feedstock',
    kind: 'feedstock',
    title: 'Добыча и подвоз сырья',
    subtitle: 'Лигнин · приёмка',
    position: [-21, 0],
    scale: 1 / 6,
    status: 'running',
    kpis: [
      { label: 'Запас сырья', value: '1 240 т' },
      { label: 'Подвоз', value: '18 т/ч' },
    ],
  },
  {
    id: 'cleaningarea',
    kind: 'cleaningarea',
    title: 'Приём и грубая очистка',
    subtitle: 'Отсев примесей',
    position: [-14, 0],
    rotationY: -Math.PI / 2,
    scale: 1 / 6,
    status: 'running',
    kpis: [
      { label: 'Производительность', value: '16 т/ч' },
      { label: 'Загрузка', value: '82%' },
    ],
  },
  {
    id: 'dryer',
    kind: 'dryer',
    title: 'Участок сушки',
    subtitle: 'Сушка лигнина',
    position: [-7, 0],
    rotationY: Math.PI,
    scale: 1 / 10,
    status: 'running',
    kpis: [
      { label: 'Влажность вх/вых', value: '55 → 12%' },
      { label: 'Температура', value: '180 °C' },
      { label: 'Загрузка', value: '90%' },
    ],
  },
  {
    id: 'boiler',
    kind: 'boiler',
    title: 'Котельная',
    subtitle: 'Теплоснабжение сушки',
    position: [-7, 10],
    rotationY: Math.PI,
    scale: 1 / 10,
    status: 'running',
    kpis: [
      { label: 'Тепловая мощность', value: '4.2 МВт' },
      { label: 'КПД', value: '88%' },
    ],
  },
  {
    id: 'finecleaning',
    kind: 'finecleaning',
    title: 'Участок тонкой очистки',
    subtitle: 'Доводка фракции',
    position: [0, 0],
    scale: 1 / 11,
    status: 'running',
    kpis: [
      { label: 'Производительность', value: '14 т/ч' },
      { label: 'Брак', value: '1.8%' },
    ],
  },
  {
    id: 'briquettes',
    kind: 'briquettes',
    title: 'Участок брикетизации',
    subtitle: 'Прессование брикета',
    position: [8, -5],
    scale: 1 / 6,
    status: 'setup',
    kpis: [
      { label: 'Производительность', value: '9 т/ч' },
      { label: 'Наладка пресса', value: '12 мин' },
    ],
  },
  {
    id: 'pileizer',
    kind: 'pileizer',
    title: 'Участок пеллетизации',
    subtitle: 'Грануляция',
    position: [8, 6],
    scale: 1 / 6,
    status: 'running',
    kpis: [
      { label: 'Производительность', value: '7 т/ч' },
      { label: 'Загрузка', value: '76%' },
    ],
  },
  {
    id: 'transformer',
    kind: 'transformer',
    title: 'Трансформаторная',
    subtitle: 'Электроснабжение',
    position: [1, 12],
    scale: 1 / 6,
    status: 'running',
    kpis: [
      { label: 'Нагрузка', value: '1.9 МВт' },
      { label: 'Резерв', value: '0.6 МВт' },
    ],
  },
  {
    id: 'wirehouse',
    kind: 'wirehouse',
    title: 'Склад готовой продукции',
    subtitle: 'Брикеты · пеллеты',
    position: [17, 0],
    scale: 1 / 6,
    status: 'running',
    kpis: [
      { label: 'Заполнение', value: '64%' },
      { label: 'Остаток', value: '820 т' },
    ],
  },
  {
    id: 'sale',
    kind: 'sale',
    title: 'Отгрузка и продажи',
    subtitle: 'Выполнение заказов',
    position: [24, -5],
    rotationY: -Math.PI / 2,
    scale: 1 / 6,
    status: 'running',
    kpis: [
      { label: 'Отгрузка', value: '210 т/сут' },
      { label: 'Активных заказов', value: '6' },
    ],
  },
  {
    id: 'marketing',
    kind: 'marketing',
    title: 'Сбыт и маркетинг',
    subtitle: 'Спрос и план продаж',
    position: [24, 6],
    rotationY: -Math.PI / 2,
    scale: 1 / 6,
    status: 'idle',
    kpis: [
      { label: 'Воронка', value: '14 лидов' },
      { label: 'Прогноз спроса', value: '+8%' },
    ],
  },
]

/** Материальные и энергетические связи между узлами. */
export const FLOWS: FlowLink[] = [
  { from: 'feedstock', to: 'cleaningarea', kind: 'material' },
  { from: 'cleaningarea', to: 'dryer', kind: 'material' },
  { from: 'dryer', to: 'finecleaning', kind: 'material' },
  { from: 'finecleaning', to: 'briquettes', kind: 'material' },
  { from: 'finecleaning', to: 'pileizer', kind: 'material' },
  { from: 'briquettes', to: 'wirehouse', kind: 'material' },
  { from: 'pileizer', to: 'wirehouse', kind: 'material' },
  { from: 'wirehouse', to: 'sale', kind: 'material' },
  { from: 'boiler', to: 'dryer', kind: 'energy' },
  { from: 'transformer', to: 'briquettes', kind: 'energy' },
]

export const STAGE_BY_ID: Record<string, PlantStage> = Object.fromEntries(
  STAGES.map((stage) => [stage.id, stage]),
)
