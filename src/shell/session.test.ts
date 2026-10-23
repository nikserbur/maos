import { describe, expect, it } from 'vitest'
import { can, parseSession, workerAccess } from './session'

describe('session', () => {
  it('parses stored session with shop and permissions', () => {
    const s = parseSession(JSON.stringify({ login: 'nach', role: 'Начальник цеха', permissions: ['READ', 'HIRE_WORKERS'], org_unit_id: 'ou-00' }))
    expect(s).toEqual({ login: 'nach', role: 'Начальник цеха', permissions: ['READ', 'HIRE_WORKERS'], orgUnitId: 'ou-00' })
    expect(can('HIRE_WORKERS', s)).toBe(true)
    expect(can('EDIT_NSI', s)).toBe(false)
  })

  it('treats broken or empty storage as a session without rights', () => {
    expect(parseSession('{oops').permissions).toEqual([])
    expect(parseSession(null).orgUnitId).toBe('')
  })

  it('derives worker registry access: full > shop > read', () => {
    expect(workerAccess(parseSession(JSON.stringify({ permissions: ['EDIT_NSI', 'HIRE_WORKERS'] })))).toBe('full')
    expect(workerAccess(parseSession(JSON.stringify({ permissions: ['HIRE_WORKERS'] })))).toBe('shop')
    expect(workerAccess(parseSession(JSON.stringify({ permissions: ['READ', 'WRITE_PLAN'] })))).toBe('read')
  })
})
