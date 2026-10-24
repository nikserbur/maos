/**
 * Кит: порядок подвала боковой панели (опасное слева за разделителем · «Отмена» · «Сохранить изменения»),
 * подтверждение называет объект и последствие, Δ к базе — U+2212, стрелка и слово, крошки — текущая страница.
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SidePanel } from './SidePanel'
import { DeltaChip, deltaTone } from './DeltaChip'
import { Breadcrumbs } from './Breadcrumbs'
import { CapsLabel } from './CapsLabel'
import { MINUS } from '../../explain/format'

describe('SidePanel', () => {
  it('подвал: опасная зона, затем «Отмена», затем основное «Сохранить изменения» (не выключено заранее)', () => {
    const html = renderToStaticMarkup(
      <SidePanel title="ТК-12 Вал" onClose={() => {}} onSave={() => {}} dirty danger={<button type="button" className="btn btn--danger">Удалить…</button>}>
        <p>поля</p>
      </SidePanel>,
    )
    const foot = html.slice(html.indexOf('dk-side__ft'))
    const iDanger = foot.indexOf('Удалить…')
    const iCancel = foot.indexOf('Отмена')
    const iSave = foot.indexOf('Сохранить изменения')
    expect(iDanger).toBeGreaterThan(-1)
    expect(iDanger).toBeLessThan(iCancel)
    expect(iCancel).toBeLessThan(iSave)
    expect(foot).toContain('dk-side__danger')
    expect(foot.slice(foot.indexOf('btn--primary') - 40, foot.indexOf('Сохранить изменения'))).not.toContain('disabled')
    expect(html).toContain('есть изменения')
  })

  it('без onSave — панель просмотра без подвала', () => {
    expect(renderToStaticMarkup(<SidePanel title="Журнал" onClose={() => {}}><p>x</p></SidePanel>)).not.toContain('dk-side__ft')
  })
})

describe('DeltaChip', () => {
  it('U+2212, стрелка ▼ и тон «хуже» при снижении величины, где лучше рост', () => {
    const html = renderToStaticMarkup(<DeltaChip value={-1_500_000} unit="₽" better="high" base="№27" />)
    expect(html).toContain(`${MINUS}1,5`)
    expect(html).toContain('▼')
    expect(html).toContain('к №27')
    expect(html).toContain('dk-delta--bad')
    expect(html).toContain('хуже')
    expect(html).not.toContain('-1')
  })
  it('тон = направление × «что лучше»', () => {
    expect(deltaTone(2, 'low')).toBe('bad')
    expect(deltaTone(-2, 'low')).toBe('good')
    expect(deltaTone(0, 'high')).toBe('neutral')
    expect(deltaTone(3)).toBe('neutral')
  })
})

describe('Breadcrumbs и CapsLabel', () => {
  it('родители — ссылки, последняя — aria-current="page"', () => {
    const html = renderToStaticMarkup(<Breadcrumbs items={[{ label: 'Справочники', href: '#/nsi' }, { label: 'Техкарты', href: '#/nsi/routing' }, { label: 'ТК-12 Вал' }]} />)
    expect(html).toContain('href="#/nsi"')
    expect(html).toContain('aria-current="page"')
    expect((html.match(/›/g) ?? []).length).toBe(2)
  })
  it('«σ прибыли» в капителях: σ не превращается в Σ', () => {
    const html = renderToStaticMarkup(<span className="text-caps"><CapsLabel text="σ прибыли" /></span>)
    expect(html).toContain('<span class="no-caps">σ</span>')
    expect(html).not.toContain('Σ')
  })
})
