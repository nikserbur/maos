import type { FlowLink, PlantStage } from './types'

/**
 * Демонстрационная схема предприятия: металлургический комбинат полного
 * цикла (руда → агломерат → чугун → сталь → прокат → отгрузка). Данные
 * статичны — на следующих фазах их источником станут НСИ и результаты
 * планировщика. Поле kind задаёт 3D-модель узла (абстрактный корпус),
 * координаты [x, z] — раскладку на полу.
 */
export const STAGES: PlantStage[] = [
  {
    id: 'oreyard',
    kind: 'feedstock',
    title: 'Рудный двор',
    subtitle: 'Приём руды, кокса, флюсов',
    position: [-21, 0],
    scale: 1 / 6,
    status: 'running',
    kpis: [
      { label: 'Запас руды', value: '12 400 т' },
      { label: 'Подача шихты', value: '120 т/ч' },
    ],
  },
  {
    id: 'crushing',
    kind: 'cleaningarea',
    title: 'Дробление и обогащение',
    subtitle: 'Подготовка шихты',
    position: [-14, 0],
    rotationY: -Math.PI / 2,
    scale: 1 / 6,
    status: 'running',
    kpis: [
      { label: 'Производительность', value: '95 т/ч' },
      { label: 'Загрузка', value: '84%' },
    ],
  },
  {
    id: 'sinter',
    kind: 'dryer',
    title: 'Аглофабрика',
    subtitle: 'Производство агломерата',
    position: [-7, 0],
    rotationY: Math.PI,
    scale: 1 / 10,
    status: 'running',
    kpis: [
      { label: 'Выпуск агломерата', value: '80 т/ч' },
      { label: 'Температура спекания', value: '1300 °C' },
      { label: 'Загрузка', value: '88%' },
    ],
  },
  {
    id: 'chp',
    kind: 'boiler',
    title: 'ТЭЦ (энергоблок)',
    subtitle: 'Пар и электроэнергия',
    position: [-7, 10],
    rotationY: Math.PI,
    scale: 1 / 10,
    status: 'running',
    kpis: [
      { label: 'Электрическая мощность', value: '18 МВт' },
      { label: 'КПД', value: '41%' },
    ],
  },
  {
    id: 'blastfurnace',
    kind: 'finecleaning',
    title: 'Доменная печь',
    subtitle: 'Выплавка чугуна',
    position: [0, 0],
    scale: 1 / 11,
    status: 'running',
    kpis: [
      { label: 'Выпуск чугуна', value: '65 т/ч' },
      { label: 'Температура дутья', value: '1500 °C' },
      { label: 'Загрузка', value: '92%' },
    ],
  },
  {
    id: 'converter',
    kind: 'briquettes',
    title: 'Кислородный конвертер',
    subtitle: 'Выплавка стали',
    position: [8, -5],
    scale: 1 / 6,
    status: 'setup',
    kpis: [
      { label: 'Производительность', value: '55 т/ч' },
      { label: 'Наладка продувки', value: '14 мин' },
    ],
  },
  {
    id: 'rolling',
    kind: 'pileizer',
    title: 'Прокатный стан',
    subtitle: 'Горячий прокат',
    position: [8, 6],
    scale: 1 / 6,
    status: 'running',
    kpis: [
      { label: 'Производительность', value: '48 т/ч' },
      { label: 'Загрузка', value: '79%' },
    ],
  },
  {
    id: 'substation',
    kind: 'transformer',
    title: 'Трансформаторная подстанция',
    subtitle: 'Электроснабжение',
    position: [1, 12],
    scale: 1 / 6,
    status: 'running',
    kpis: [
      { label: 'Нагрузка', value: '16 МВт' },
      { label: 'Резерв', value: '4 МВт' },
    ],
  },
  {
    id: 'warehouse',
    kind: 'wirehouse',
    title: 'Склад проката',
    subtitle: 'Готовая продукция',
    position: [17, 0],
    scale: 1 / 6,
    status: 'running',
    kpis: [
      { label: 'Заполнение', value: '61%' },
      { label: 'Остаток', value: '5 200 т' },
    ],
  },
  {
    id: 'shipping',
    kind: 'sale',
    title: 'Отгрузка',
    subtitle: 'Выполнение заказов',
    position: [24, -5],
    rotationY: -Math.PI / 2,
    scale: 1 / 6,
    status: 'running',
    kpis: [
      { label: 'Отгрузка', value: '1 150 т/сут' },
      { label: 'Активных заказов', value: '9' },
    ],
  },
  {
    id: 'sales',
    kind: 'marketing',
    title: 'Сбыт и маркетинг',
    subtitle: 'Спрос и план продаж',
    position: [24, 6],
    rotationY: -Math.PI / 2,
    scale: 1 / 6,
    status: 'idle',
    kpis: [
      { label: 'Воронка', value: '21 лид' },
      { label: 'Прогноз спроса', value: '+6%' },
    ],
  },
]

/** Связи между узлами: материальные, энергетические и газовые потоки. */
export const FLOWS: FlowLink[] = [
  { from: 'oreyard', to: 'crushing', kind: 'material' },
  { from: 'crushing', to: 'sinter', kind: 'material' },
  { from: 'sinter', to: 'blastfurnace', kind: 'material' },
  { from: 'blastfurnace', to: 'converter', kind: 'material' },
  { from: 'converter', to: 'rolling', kind: 'material' },
  { from: 'rolling', to: 'warehouse', kind: 'material' },
  { from: 'warehouse', to: 'shipping', kind: 'material' },
  { from: 'chp', to: 'sinter', kind: 'energy' },
  { from: 'substation', to: 'converter', kind: 'energy' },
  { from: 'substation', to: 'rolling', kind: 'energy' },
  { from: 'blastfurnace', to: 'chp', kind: 'gas' },
  { from: 'converter', to: 'chp', kind: 'gas' },
]

export const STAGE_BY_ID: Record<string, PlantStage> = Object.fromEntries(
  STAGES.map((stage) => [stage.id, stage]),
)
