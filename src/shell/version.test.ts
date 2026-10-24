/**
 * Расхождение версий интерфейса и сервера (снимки «после» показывали «PESCADITO v0.74.2» при
 * package.json 0.75.0: сервер разработки запущен до повышения версии) — видно в статус-баре.
 */
import { describe, expect, it } from 'vitest'
import { versionMismatch } from './version'

describe('versionMismatch', () => {
  it('разные версии — подпись «сервер v…»; одинаковые и неизвестные — нет', () => {
    expect(versionMismatch('0.74.2', '0.75.0')).toBe('сервер v0.75.0')
    expect(versionMismatch('0.75.0', '0.75.0')).toBeNull()
    expect(versionMismatch('0.75.0', null)).toBeNull()
    expect(versionMismatch('dev', '0.75.0')).toBeNull()
  })
})
