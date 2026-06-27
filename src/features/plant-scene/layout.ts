import type { FlowLink, PlantStage } from './types'

/**
 * Демонстрационная схема предприятия: металлургический комбинат полного
 * цикла (руда → агломерат → чугун → сталь → прокат → отгрузка). Данные
 * статичны — на следующих фазах их источником станут НСИ и результаты
 * планировщика. Поле kind задаёт 3D-модель узла (абстрактный корпус),
 * координаты [x, z] — раскладку на полу.
 */
export const STAGES: PlantStage[] = [
  // ── Сырьё ──────────────────────────────────────────────────────────────────
  {
    id: 'scrapyard',
    kind: 'feedstock',
    title: 'Скрапный двор',
    subtitle: 'Металлолом и скрап',
    position: [-24, -8],
    scale: 1 / 7,
    status: 'running',
    kpis: [
      { label: 'Запас лома', value: '3 200 т' },
      { label: 'Сортировка', value: '40 т/ч' },
    ],
  },
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
    id: 'cokeyard',
    kind: 'feedstock',
    title: 'Коксовый двор',
    subtitle: 'Хранение и подготовка кокса',
    position: [-24, 8],
    scale: 1 / 7,
    status: 'running',
    kpis: [
      { label: 'Запас кокса', value: '2 800 т' },
      { label: 'Влажность', value: '4,2%' },
    ],
  },

  // ── Подготовка шихты ──────────────────────────────────────────────────────
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
    id: 'screening',
    kind: 'cleaningarea',
    title: 'Грохочение и классификация',
    subtitle: 'Сортировка по фракциям',
    position: [-14, -8],
    rotationY: -Math.PI / 2,
    scale: 1 / 7,
    status: 'running',
    kpis: [
      { label: 'Пропускная способность', value: '70 т/ч' },
      { label: 'КПД грохота', value: '92%' },
    ],
  },

  // ── Аглофабрика и энергетика ──────────────────────────────────────────────
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
    id: 'gasclean',
    kind: 'finecleaning',
    title: 'Газоочистка',
    subtitle: 'Доменный газ и пылеулавливание',
    position: [-7, -10],
    rotationY: Math.PI,
    scale: 1 / 8,
    status: 'down',
    kpis: [
      { label: 'Очистка газа', value: '95%' },
      { label: 'Давление', value: '0,8 бар' },
    ],
  },

  // ── Доменное производство ─────────────────────────────────────────────────
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
    id: 'hotblast',
    kind: 'boiler',
    title: 'Воздухонагреватели',
    subtitle: 'Горячее дутьё для доменной',
    position: [0, -10],
    scale: 1 / 8,
    status: 'running',
    kpis: [
      { label: 'Температура дутья', value: '1250 °C' },
      { label: 'Расход воздуха', value: '4 000 м³/мин' },
    ],
  },

  // ── Сталеплавильное производство ──────────────────────────────────────────
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
    id: 'eaf',
    kind: 'briquettes',
    title: 'Электродуговая печь (ЭДП)',
    subtitle: 'Выплавка из лома',
    position: [8, 5],
    scale: 1 / 7,
    status: 'running',
    kpis: [
      { label: 'Производительность', value: '35 т/ч' },
      { label: 'Расход э/э', value: '420 кВт·ч/т' },
    ],
  },
  {
    id: 'ladle',
    kind: 'finecleaning',
    title: 'Установка ковш-печь',
    subtitle: 'Внепечная обработка стали',
    position: [8, -14],
    scale: 1 / 7,
    status: 'running',
    kpis: [
      { label: 'Обработка плавок', value: '8 пл/смену' },
      { label: 'Температура', value: '1610 °C' },
    ],
  },

  // ── Разливка ──────────────────────────────────────────────────────────────
  {
    id: 'ccm',
    kind: 'pileizer',
    title: 'МНЛЗ (Непрерывная разливка)',
    subtitle: 'Получение слябов и заготовок',
    position: [16, -8],
    scale: 1 / 6,
    status: 'running',
    kpis: [
      { label: 'Скорость разливки', value: '1,2 м/мин' },
      { label: 'Выпуск слябов', value: '45 т/ч' },
    ],
  },

  // ── Прокат ────────────────────────────────────────────────────────────────
  {
    id: 'rolling',
    kind: 'pileizer',
    title: 'Прокатный стан (горячий)',
    subtitle: 'Горячий прокат листа и рулонов',
    position: [16, 4],
    scale: 1 / 6,
    status: 'running',
    kpis: [
      { label: 'Производительность', value: '48 т/ч' },
      { label: 'Загрузка', value: '79%' },
    ],
  },
  {
    id: 'coldrolling',
    kind: 'cleaningarea',
    title: 'Прокатный стан (холодный)',
    subtitle: 'Тонкий лист до 1,5 мм',
    position: [16, 14],
    scale: 1 / 7,
    status: 'idle',
    kpis: [
      { label: 'Производительность', value: '28 т/ч' },
      { label: 'Минимальная толщина', value: '0,5 мм' },
    ],
  },
  {
    id: 'heattreat',
    kind: 'finecleaning',
    title: 'Термическое отделение',
    subtitle: 'Нормализация и отпуск',
    position: [16, -18],
    scale: 1 / 8,
    status: 'running',
    kpis: [
      { label: 'Температура нагрева', value: '900 °C' },
      { label: 'Производительность', value: '20 т/ч' },
    ],
  },

  // ── Электроснабжение ──────────────────────────────────────────────────────
  {
    id: 'substation',
    kind: 'transformer',
    title: 'Главная подстанция',
    subtitle: 'Электроснабжение 110 кВ',
    position: [1, 12],
    scale: 1 / 6,
    status: 'running',
    kpis: [
      { label: 'Нагрузка', value: '16 МВт' },
      { label: 'Резерв', value: '4 МВт' },
    ],
  },
  {
    id: 'substation2',
    kind: 'transformer',
    title: 'Подстанция ПС-2',
    subtitle: 'Питание сталеплавильного цеха',
    position: [8, -22],
    scale: 1 / 7,
    status: 'running',
    kpis: [
      { label: 'Нагрузка', value: '22 МВт' },
      { label: 'КТП', value: '35 кВ' },
    ],
  },

  // ── Склады ────────────────────────────────────────────────────────────────
  {
    id: 'warehouse',
    kind: 'wirehouse',
    title: 'Склад проката',
    subtitle: 'Готовая продукция',
    position: [24, 4],
    scale: 1 / 6,
    status: 'running',
    kpis: [
      { label: 'Заполнение', value: '61%' },
      { label: 'Остаток', value: '5 200 т' },
    ],
  },
  {
    id: 'slabyard',
    kind: 'wirehouse',
    title: 'Склад слябов и заготовок',
    subtitle: 'Промежуточный склад п/ф',
    position: [24, -6],
    scale: 1 / 7,
    status: 'running',
    kpis: [
      { label: 'Запас слябов', value: '1 800 т' },
      { label: 'Оборачиваемость', value: '2,4 смены' },
    ],
  },

  // ── Ремонтные службы ──────────────────────────────────────────────────────
  {
    id: 'maintenance',
    kind: 'marketing',
    title: 'РМЦ (ремонтно-механический цех)',
    subtitle: 'Обслуживание и ремонт',
    position: [0, -22],
    scale: 1 / 7,
    status: 'idle',
    kpis: [
      { label: 'Плановые ремонты', value: '3 / нед' },
      { label: 'Загрузка', value: '55%' },
    ],
  },
  {
    id: 'lab',
    kind: 'marketing',
    title: 'Центральная лаборатория',
    subtitle: 'ОТК и анализы',
    position: [-14, -18],
    scale: 1 / 7,
    status: 'running',
    kpis: [
      { label: 'Анализов/сутки', value: '480' },
      { label: 'Сертификаты', value: '100%' },
    ],
  },

  // ── Отгрузка и сбыт ───────────────────────────────────────────────────────
  {
    id: 'shipping',
    kind: 'sale',
    title: 'Отгрузка (жел.-дор.)',
    subtitle: 'Выполнение заказов',
    position: [31, -5],
    rotationY: -Math.PI / 2,
    scale: 1 / 6,
    status: 'running',
    kpis: [
      { label: 'Отгрузка', value: '1 150 т/сут' },
      { label: 'Активных заказов', value: '9' },
    ],
  },
  {
    id: 'shipping2',
    kind: 'sale',
    title: 'Отгрузка (автотранспорт)',
    subtitle: 'Мелкие партии и спецзаказы',
    position: [31, 6],
    rotationY: -Math.PI / 2,
    scale: 1 / 7,
    status: 'running',
    kpis: [
      { label: 'Отгрузка', value: '240 т/сут' },
      { label: 'Рейсов в день', value: '12' },
    ],
  },
  {
    id: 'sales',
    kind: 'marketing',
    title: 'Сбыт и маркетинг',
    subtitle: 'Спрос и план продаж',
    position: [31, 16],
    rotationY: -Math.PI / 2,
    scale: 1 / 6,
    status: 'idle',
    kpis: [
      { label: 'Воронка', value: '21 лид' },
      { label: 'Прогноз спроса', value: '+6%' },
    ],
  },
]

/** Физические связи между узлами (конвейеры, трубопроводы, кабели). */
export const FLOWS: FlowLink[] = [
  // Сырьё → подготовка
  { from: 'scrapyard',    to: 'eaf' },
  { from: 'oreyard',     to: 'crushing' },
  { from: 'cokeyard',    to: 'sinter' },
  { from: 'crushing',    to: 'sinter' },
  { from: 'crushing',    to: 'screening' },
  { from: 'screening',   to: 'sinter' },
  // Аглофабрика → доменная
  { from: 'sinter',      to: 'blastfurnace' },
  { from: 'chp',         to: 'sinter' },
  { from: 'chp',         to: 'blastfurnace' },
  { from: 'gasclean',    to: 'chp' },
  { from: 'hotblast',    to: 'blastfurnace' },
  { from: 'blastfurnace', to: 'gasclean' },
  { from: 'blastfurnace', to: 'hotblast' },
  // Чугун → сталь
  { from: 'blastfurnace', to: 'converter' },
  { from: 'blastfurnace', to: 'eaf' },
  { from: 'converter',   to: 'ladle' },
  { from: 'eaf',         to: 'ladle' },
  // Сталь → разливка
  { from: 'ladle',       to: 'ccm' },
  // Разливка → прокат
  { from: 'ccm',         to: 'rolling' },
  { from: 'ccm',         to: 'heattreat' },
  { from: 'heattreat',   to: 'rolling' },
  { from: 'rolling',     to: 'coldrolling' },
  // Прокат → склад → отгрузка
  { from: 'rolling',     to: 'warehouse' },
  { from: 'coldrolling', to: 'warehouse' },
  { from: 'ccm',         to: 'slabyard' },
  { from: 'slabyard',    to: 'rolling' },
  { from: 'warehouse',   to: 'shipping' },
  { from: 'warehouse',   to: 'shipping2' },
  // Электроснабжение
  { from: 'substation',  to: 'converter' },
  { from: 'substation',  to: 'sinter' },
  { from: 'substation2', to: 'eaf' },
  { from: 'substation2', to: 'ladle' },
  // Сбыт
  { from: 'shipping',    to: 'sales' },
  { from: 'shipping2',   to: 'sales' },
]

export const STAGE_BY_ID: Record<string, PlantStage> = Object.fromEntries(
  STAGES.map((s) => [s.id, s]),
)
