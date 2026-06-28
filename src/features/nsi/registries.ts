/**
 * Определения реестров НСИ. Ключи колонок (key) точно соответствуют
 * именам полей в ответах API — src/lib/api.ts.
 */
export interface RegistryColumn {
  key: string
  title: string
}

export interface RegistryDef {
  id: string
  title: string
  description: string
  columns: RegistryColumn[]
}

export const REGISTRIES: RegistryDef[] = [
  {
    id: 'workcentertype',
    title: 'Типы оборудования',
    description:
      'Классы взаимозаменяемого оборудования. Задаются при внедрении и определяют параметры оборудования.',
    columns: [
      { key: 'name',           title: 'Наименование' },
      { key: 'group_name',     title: 'Группа' },
      { key: 'kind',           title: '3D-вид' },
      { key: 'interchangeable', title: 'Взаимозам.' },
    ],
  },
  {
    id: 'machine',
    title: 'Оборудование',
    description:
      'Единицы оборудования на схеме: привязка к типу, подразделению/цеху, расписанию, статус и параметры.',
    columns: [
      { key: 'name',      title: 'Наименование' },
      { key: 'wc_type_id', title: 'Тип' },
      { key: 'org_unit',  title: 'Подразделение' },
      { key: 'status',    title: 'Статус' },
      { key: 'schedule',  title: 'Расписание' },
    ],
  },
  {
    id: 'product',
    title: 'Изделия',
    description:
      'Номенклатура с составом (BOM) и запасами. Каждое изделие привязано к техкартам — как его произвести.',
    columns: [
      { key: 'code',      title: 'Код' },
      { key: 'name',      title: 'Наименование' },
      { key: 'role',      title: 'Роль' },
      { key: 'unit',      title: 'Ед.' },
      { key: 'parent_id', title: 'Входит в' },
      { key: 'stock',     title: 'Остаток' },
      { key: 'purchased', title: 'Покупное' },
    ],
  },
  {
    id: 'routing',
    title: 'Техкарты',
    description:
      'Маршрут изготовления изделия — последовательность операций. Создание техкарты = задание последовательности операций.',
    columns: [
      { key: 'id',         title: 'Код' },
      { key: 'name',       title: 'Название' },
      { key: 'product_id', title: 'Изделие' },
      { key: 'created_at', title: 'Создано' },
    ],
  },
  {
    id: 'operation',
    title: 'Операции',
    description:
      'Технологические операции: время/стоимость/риск, допустимый тип оборудования, порядок, входные изделия.',
    columns: [
      { key: 'id',            title: 'Код' },
      { key: 'name',          title: 'Наименование' },
      { key: 'order_no',      title: '№' },
      { key: 'op_type',       title: 'Тип' },
      { key: 'wc_types',      title: 'Типы оборуд.' },
      { key: 'setup_required', title: 'Наладка' },
    ],
  },
  {
    id: 'worker',
    title: 'Рабочие',
    description: 'Персонал и компетенции. Ресурс плана наравне с оборудованием («оборудование + рабочий»).',
    columns: [
      { key: 'tab_no',    title: 'Таб. №' },
      { key: 'last_name', title: 'Фамилия' },
      { key: 'first_name', title: 'Имя' },
      { key: 'org_unit',  title: 'Подразделение' },
      { key: 'position',  title: 'Должность' },
      { key: 'grade',     title: 'Разряд' },
    ],
  },
]
