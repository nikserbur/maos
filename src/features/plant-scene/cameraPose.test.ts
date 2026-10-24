import { describe, expect, it } from 'vitest'
import { DEFAULT_DIR, MIN_LIFT, fitBoxDistance, fitPose, guardPose, levelBounds, quantile, viewDirection, withPose, type Pose } from './cameraPose'

const at = (x: number, z: number) => ({ position: [x, z] as const })

describe('levelBounds — P5–P95, выброс не раздувает кадр', () => {
  it('квантиль с интерполяцией', () => {
    expect(quantile([0, 10], 0.5)).toBe(5)
    expect(quantile([], 0.5)).toBe(0)
  })

  it('один далёкий станок почти не расширяет рамку уровня', () => {
    const row = Array.from({ length: 30 }, (_, i) => at(i * 4 - 58, 0))
    const plain = levelBounds(row)
    const withOutlier = levelBounds([...row, at(600, 0)])
    expect(withOutlier.hw).toBeLessThan(plain.hw * 1.1)
    expect(withOutlier.cx).toBeLessThan(10)
  })

  it('пустой уровень — рамка по умолчанию, не ноль', () => {
    const b = levelBounds([])
    expect(b.hw).toBeGreaterThan(0)
    expect(b.radius).toBeGreaterThan(0)
  })
})

describe('ракурс и дистанция', () => {
  it('вытянутый цех — перпендикулярно длинной оси под 55°', () => {
    const dir = viewDirection({ hw: 60, hd: 8 })
    expect(dir[0]).toBeCloseTo(0, 5)
    expect(Math.asin(dir[1]) * (180 / Math.PI)).toBeCloseTo(55, 0)
    expect(viewDirection({ hw: 10, hd: 9 })).toBe(DEFAULT_DIR)
    const alongZ = viewDirection({ hw: 8, hd: 60 })
    expect(alongZ[2]).toBeCloseTo(0, 5)
  })

  it('перпендикулярный ракурс вписывает длинный цех ближе, чем диагональный', () => {
    const b = { hw: 60, hd: 8 }
    const perp = fitBoxDistance(b, viewDirection(b), 44, 1.6)
    const diag = fitBoxDistance(b, DEFAULT_DIR, 44, 1.6)
    expect(perp).toBeLessThan(diag)
    expect(perp).toBeGreaterThan(0)
  })
})

describe('поза камеры по уровням', () => {
  it('камера не ниже цели + 2', () => {
    const low: Pose = { position: [10, -5, 10], target: [0, 1, 0] }
    expect(guardPose(low).position[1]).toBe(1 + MIN_LIFT)
    const b = levelBounds([at(0, 0), at(10, 10)])
    expect(fitPose(b, [1, 0, 0], 50).position[1]).toBeGreaterThanOrEqual(1 + MIN_LIFT)
  })

  it('уход сохраняет позу уровня, возврат её восстанавливает; кэш не мутирует', () => {
    const site: Pose = { position: [40, 30, 40], target: [0, 1, 0] }
    const shop: Pose = { position: [5, 12, 5], target: [1, 1, 1] }
    const empty = new Map<string, Pose>()
    const c1 = withPose(empty, 'factory:f', site)
    const c2 = withPose(c1, 'shop:a', shop)
    expect(empty.size).toBe(0)
    expect(c2.get('factory:f')).toEqual(site)
    expect(c2.get('shop:a')).toEqual(shop)
    expect(withPose(c2, 'factory:f', shop).get('factory:f')).toEqual(shop)
  })
})
