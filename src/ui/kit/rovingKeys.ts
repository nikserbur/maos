/**
 * Клавиши группы «один из N» с roving tabindex (APG radio/tabs): ←/↑ — назад, →/↓ — вперёд
 * (по кругу), Home/End — края. `axis="horizontal"` — только ←/→ (вкладки: ↑/↓ прокручивают страницу).
 * Чистая функция — проверяется тестом без DOM.
 */
export function rovingNext(key: string, at: number, count: number, axis: 'horizontal' | 'both' = 'both'): number {
  if (count <= 0) return -1
  const from = at < 0 ? 0 : at
  const fwd = key === 'ArrowRight' || (axis === 'both' && key === 'ArrowDown')
  const back = key === 'ArrowLeft' || (axis === 'both' && key === 'ArrowUp')
  if (fwd) return at < 0 ? 0 : (from + 1) % count
  if (back) return at < 0 ? count - 1 : (from - 1 + count) % count
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  return -1
}
