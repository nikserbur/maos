import { describe, expect, it } from 'vitest'
import { MAX_COMPARE, compareAnchor, initialCompare, parseScenarioAnchor, resolveOpenId, scenarioAnchor, toggleCompare, workingIdOf } from './scenarioRoute'

describe('адрес экрана «Сценарии»', () => {
  it('разбирает сценарий и вкладку, старые ссылки на вкладку и сравнение', () => {
    expect(parseScenarioAnchor('7/forecast')).toEqual({ compare: false, id: '7', tab: 'forecast', ids: [] })
    expect(parseScenarioAnchor('distributions')).toEqual({ compare: false, id: null, tab: 'distributions', ids: [] })
    expect(parseScenarioAnchor(null)).toEqual({ compare: false, id: null, tab: 'conditions', ids: [] })
    expect(parseScenarioAnchor('7/junk').tab).toBe('conditions')
    expect(parseScenarioAnchor('compare/3,5,3').ids).toEqual(['3', '5'])
    expect(parseScenarioAnchor('compare/1,2,3,4,5,6').ids).toHaveLength(MAX_COMPARE)
  })

  it('строит адреса туда и обратно', () => {
    expect(parseScenarioAnchor(scenarioAnchor('12', 'forecast'))).toMatchObject({ id: '12', tab: 'forecast' })
    expect(parseScenarioAnchor(compareAnchor(['1', '2'])).ids).toEqual(['1', '2'])
    expect(compareAnchor([])).toBe('compare')
  })

  it('открытый: адрес → рабочий → первый; неизвестный id из адреса пропускается', () => {
    const ids = ['1', '2', '3']
    expect(resolveOpenId('3', '2', ids)).toBe('3')
    expect(resolveOpenId(null, '2', ids)).toBe('2')
    expect(resolveOpenId('9', undefined, ids)).toBe('1')
    expect(workingIdOf('9', ids)).toBe('1')
    expect(workingIdOf(undefined, [])).toBe('')
  })

  it('сравнение начинается с рабочего и открытого; шестой не добавляется', () => {
    expect(initialCompare('1', '3')).toEqual(['1', '3'])
    expect(initialCompare('1', '1')).toEqual(['1'])
    const five = ['1', '2', '3', '4', '5']
    expect(toggleCompare(five, '6')).toEqual(five)
    expect(toggleCompare(five, '2')).toEqual(['1', '3', '4', '5'])
  })
})
