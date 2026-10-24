/**
 * Id узлов схемы (без зависимостей от 3D): узел-цех — `shop:<org_unit>`, узел-завод —
 * `factory:<org_unit>`; станок — id записи оборудования как есть.
 */

/** Префикс id узла-цеха (чтобы не пересекался с id машины). */
export const SHOP_PREFIX = 'shop:'
export const shopNodeId = (orgUnitId: string): string => SHOP_PREFIX + orgUnitId

/** Префикс id узла-завода/склада (мировая карта). */
export const FACTORY_PREFIX = 'factory:'
export const factoryNodeId = (orgUnitId: string): string => FACTORY_PREFIX + orgUnitId
/** Виртуальный завод для legacy-БД (плоские цеха без заводов) — «одно предприятие». */
export const DEFAULT_FACTORY_ID = FACTORY_PREFIX + '__default__'
/** Синтетический цех «Без цеха» — для станков без подразделения. */
export const SYNTHETIC_SHOP = SHOP_PREFIX + '__none__'
