/**
 * Вкладки, сегменты и карточки выбора (владелец: «выбор из радио-пилюль — надо лучше»):
 * навигация по URL — ссылки с aria-current="page"; локальные вкладки — tablist ↔ tabpanel;
 * режим — radiogroup с aria-checked, ширина по содержимому, без многоточий; счётчик — отдельным
 * бейджем с пояснением для диктора («Все, 200 записей», а не «Все200»); клавиши — roving.
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Tabs, TabPanel } from './Tabs'
import { Segmented, PillTabs } from './Segmented'
import { ChoiceCards } from './ChoiceCards'
import { rovingNext } from './rovingKeys'

const noop = () => {}

describe('Tabs', () => {
  it('все пункты с href → <nav> со ссылками, активная — aria-current="page", счётчик с пояснением', () => {
    const html = renderToStaticMarkup(
      <Tabs label="Вкладки сценария" value="dist" items={[
        { id: 'cond', label: 'Условия', href: '#/scenarios/1/cond' },
        { id: 'dist', label: 'Распределения', href: '#/scenarios/1/dist', count: 2, countLabel: '2 из 76 рядов заданы вручную' },
        { id: 'fc', label: 'Прогноз и проверка', href: '#/scenarios/1/fc' },
      ]} />,
    )
    expect(html).toMatch(/^<nav class="dk-tabs dk-tabs--page" aria-label="Вкладки сценария">/)
    expect(html).toContain('<a class="dk-tab is-on" data-tab="dist" data-active="true" href="#/scenarios/1/dist" aria-current="page">')
    expect(html).toContain('dk-tab__count')
    expect(html).toContain(', 2 из 76 рядов заданы вручную')
    expect(html).not.toContain('role="tab"')
  })

  it('нулевой счётчик скрыт; без href → tablist с id и aria-controls, roving tabindex', () => {
    const html = renderToStaticMarkup(
      <Tabs label="Разделы MENTAT" size="panel" idBase="mt" value="ask" onChange={noop} items={[
        { id: 'ask', label: 'Вопрос' }, { id: 'hist', label: 'История', count: 0 },
      ]} />,
    )
    expect(html).toContain('role="tablist"')
    expect(html).toContain('id="mt-tab-ask"')
    expect(html).toContain('aria-controls="mt-panel-hist"')
    expect(html).toMatch(/aria-selected="true" tabindex="0"/)
    expect(html).toMatch(/aria-selected="false" tabindex="-1"/)
    expect(html).not.toContain('dk-tab__count')
    const panel = renderToStaticMarkup(<TabPanel idBase="mt" id="ask"><p>x</p></TabPanel>)
    expect(panel).toContain('role="tabpanel" id="mt-panel-ask" aria-labelledby="mt-tab-ask"')
  })

  it('совместимость: Segmented kind="tab"/"nav" и PillTabs рисуются вкладками, а не пилюлями', () => {
    const tab = renderToStaticMarkup(<Segmented kind="tab" size="lg" label="Разделы" value="a" onChange={noop} options={[{ id: 'a', label: 'А' }, { id: 'b', label: 'Б' }]} />)
    expect(tab).toContain('dk-tabs--page')
    expect(tab).not.toContain('dk-seg')
    const nav = renderToStaticMarkup(<Segmented kind="nav" size="md" label="Вкладки" value="a" onChange={noop} options={[{ id: 'a', label: 'А' }, { id: 'b', label: 'Б' }]} />)
    expect(nav).toContain('<nav')
    expect(nav).toContain('aria-current="page"')
    const pill = renderToStaticMarkup(<PillTabs ariaLabel="Разделы" value="a" onChange={noop} tabs={[{ id: 'a', label: 'А' }, { id: 'b', label: 'Б' }]} />)
    expect(pill).toContain('dk-tabs--page')
  })
})

describe('Segmented (режим)', () => {
  it('radiogroup с aria-checked; счётчик — бейдж с пояснением; lg → md', () => {
    const html = renderToStaticMarkup(
      <Segmented label="Вид записей" size="lg" value="all" onChange={noop} options={[
        { id: 'all', label: 'Все', count: 200, countLabel: '200 записей' }, { id: 'chg', label: 'Изменения', count: 93 },
      ]} />,
    )
    expect(html).toContain('role="radiogroup"')
    expect(html).toContain('dk-seg--md')
    expect(html).toMatch(/role="radio" aria-checked="true" tabindex="0"/)
    expect(html).toContain('<span class="dk-vh">, 200 записей</span>')
    expect(html).toContain('dk-seg__count')
  })

  it('недоступный вариант называет причину; группа может быть выключена целиком', () => {
    const html = renderToStaticMarkup(
      <Segmented label="Режим схемы" disabled value="view" onChange={noop} options={[
        { id: 'view', label: 'Просмотр' }, { id: 'sim', label: 'Симуляция', disabled: true, reason: 'нет плана' },
      ]} />,
    )
    expect(html).toContain('aria-disabled="true"')
    expect(html).toContain('недоступно: нет плана')
  })

  it('CSS: подписи не обрезаются, высоты = токены контролов, ширина по содержимому', () => {
    const css = readFileSync(fileURLToPath(new URL('./segmented.css', import.meta.url)), 'utf8')
    const opt = css.slice(css.indexOf('.dk-seg__opt {'), css.indexOf('}', css.indexOf('.dk-seg__opt {')))
    expect(opt).not.toContain('text-overflow')
    expect(opt).not.toContain('ellipsis')
    expect(css).toContain('--seg-h: var(--control)')
    expect(css).toContain('--seg-h: var(--control-compact)')
    expect(css).toContain('width: max-content')
    const kit = readFileSync(fileURLToPath(new URL('./kit.css', import.meta.url)), 'utf8')
    expect(kit).not.toMatch(/\.dk-seg__opt\s*\{/)
  })
})

describe('одна грамматика селекторов (владелец: «выбор из радио-пилюль — надо лучше», «▲ на второй строке»)', () => {
  const css = (f: string) => readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8')
  /** Правило, которое начинается с селектора в начале строки (а не составной селектор где-то в середине). */
  const ruleOf = (text: string, sel: string) => {
    const at = text.indexOf(`\n${sel} {`)
    return at < 0 ? '' : text.slice(at + 1, text.indexOf('}', at))
  }

  it('подпись-узел и глиф состояния — в одной строке: текст в ячейке сетки, глиф вне подписи', () => {
    const seg = renderToStaticMarkup(
      <Segmented label="Фильтр журнала" value="err" onChange={noop} options={[
        { id: 'all', label: 'Все', count: 200 },
        { id: 'err', label: <>Отказы и ошибки</>, count: 6, status: <span className="glyph-setup" title="есть отказы" /> },
      ]} />,
    )
    expect(seg).toContain('<span class="dk-seg__label"><span class="dk-seg__text">Отказы и ошибки</span></span>')
    expect(seg).toMatch(/<\/span><\/span><span class="dk-seg__count"[^>]*><span>6<\/span><\/span><span class="dk-seg__status"><span class="glyph-setup"/)
    const tab = renderToStaticMarkup(
      <Tabs label="Разделы" value="a" onChange={noop} items={[{ id: 'a', label: <>Узкое место</>, status: <span className="glyph-setup" /> }, { id: 'b', label: 'Гант' }]} />,
    )
    expect(tab).toContain('<span class="dk-tab__label"><span class="dk-tab__text">Узкое место</span></span><span class="dk-tab__status">')
    for (const [file, label, text] of [['./segmented.css', '.dk-seg__label', '.dk-seg__text'], ['./tabs.css', '.dk-tab__label', '.dk-tab__text']] as const) {
      const t = css(file)
      expect(ruleOf(t, label)).toContain('display: inline-grid')
      expect(ruleOf(t, label)).not.toContain('flex-direction: column')
      expect(t).toContain(`${text}, ${label}::after { grid-area: 1 / 1;`)
    }
  })

  it('видимая подпись группы слева (обычный регистр) и пояснение выбранного варианта под сегментом', () => {
    const html = renderToStaticMarkup(
      <Segmented label="Финансирование" caption="Финансирование" describe value="fact" onChange={noop} options={[
        { id: 'fact', label: 'Кредит по мере нехватки', hint: 'Кредит берётся, когда касса уходит ниже буфера.' },
        { id: 'plan', label: 'Кредитная линия по графику', title: 'Линия открывается заранее по графику платежей.' },
      ]} />,
    )
    const cap = html.match(/<span class="dk-seg-cap" id="([^"]+)">Финансирование<\/span>/)
    expect(cap).not.toBeNull()
    expect(html).toContain(`aria-labelledby="${cap?.[1]}"`)
    const hint = html.match(/<span class="dk-seg-hint" id="([^"]+)">Кредит берётся, когда касса уходит ниже буфера.<\/span>/)
    expect(hint).not.toBeNull()
    expect(html).toContain(`aria-describedby="${hint?.[1]}"`)
    const plain = renderToStaticMarkup(<Segmented label="Вид" value="a" onChange={noop} options={[{ id: 'a', label: 'А' }, { id: 'b', label: 'Б' }]} />)
    expect(plain).not.toContain('dk-seg-field')
    // Словарь: подпись группы — обычным регистром (CAPS с разрядкой владелец уже назвал некрасивым).
    expect(ruleOf(css('./segmented.css'), '.dk-seg-cap')).not.toMatch(/text-transform:\s*uppercase|letter-spacing/)
  })

  it('счётчик — один бейдж у вкладок и сегментов (18 px, табличные цифры); иконки — только у вкладок панели', () => {
    for (const [file, sel] of [['./segmented.css', '.dk-seg__count'], ['./tabs.css', '.dk-tab__count']] as const) {
      const r = ruleOf(css(file), sel)
      expect(r).toContain('height: 18px')
      expect(r).toContain('tabular-nums')
      expect(r).toContain('border-radius: var(--radius-pill)')
    }
    const page = renderToStaticMarkup(<Tabs label="Разделы" value="a" onChange={noop} items={[{ id: 'a', label: 'KPI', icon: 'chart' }, { id: 'b', label: 'Потоки', icon: 'graph' }]} />)
    expect(page).not.toContain('<svg')
    const panel = renderToStaticMarkup(<Tabs label="Разделы" size="panel" value="a" onChange={noop} items={[{ id: 'a', label: 'KPI', icon: 'chart' }, { id: 'b', label: 'Потоки' }]} />)
    expect(panel).toContain('<svg')
  })

  it('активная вкладка под курсором — без подложки-«пилюли»; полоса с невидимыми вкладками гаснет у края', () => {
    const t = css('./tabs.css')
    expect(t).toContain('.dk-tab.is-on:hover::before { background: transparent; }')
    expect(t).toMatch(/:not\(\.is-on\)::before \{ background: var\(--bg-hover\); \}/)
    expect(t).toContain('.dk-tabs__list[data-overflow-end]')
    expect(t).toContain('.dk-tabs__scroll--end')
  })

  it('строка с сегментом переносится раньше, чем сегмент свернётся в список; список — в теме кита', () => {
    const t = css('./segmented.css')
    expect(t).toMatch(/:where\(:has\(> \.dk-seg, > \.dk-seg-field, > \.dk-seg-select\)\) \{ flex-wrap: wrap; \}/)
    const sel = ruleOf(t, '.dk-seg-select')
    expect(sel).toContain('appearance: none')
    expect(sel).toContain('background-image')
  })
})

describe('ChoiceCards', () => {
  it('radiogroup, выбранная — ✓ и aria-checked, недоступная — видимая причина через aria-describedby', () => {
    const html = renderToStaticMarkup(
      <ChoiceCards label="Пресет сценария" value="base" onChange={noop} options={[
        { id: 'base', title: 'Базовый', description: 'обучен на истории 2013–2026' },
        { id: 'covid', title: 'Как COVID-2020', meta: 'повтор 2020-03 … 2020-08' },
        { id: 'rl', title: 'Обучение с подкреплением', disabled: true, reason: 'нет обученной политики' },
      ]} />,
    )
    expect(html).toContain('role="radiogroup"')
    expect(html).toMatch(/role="radio" aria-checked="true"[^>]*tabindex="0"/)
    expect(html).toContain('dk-card-opt__check')
    expect(html).toMatch(/aria-describedby="[^"]+"/)
    expect(html).toContain('нет обученной политики')
  })
})

describe('rovingNext — клавиши группы', () => {
  it('стрелки по кругу, Home/End, вертикальные стрелки игнорируются у вкладок', () => {
    expect(rovingNext('ArrowRight', 2, 3)).toBe(0)
    expect(rovingNext('ArrowLeft', 0, 3)).toBe(2)
    expect(rovingNext('ArrowDown', 1, 3)).toBe(2)
    expect(rovingNext('Home', 2, 3)).toBe(0)
    expect(rovingNext('End', 0, 3)).toBe(2)
    expect(rovingNext('ArrowDown', 1, 3, 'horizontal')).toBe(-1)
    expect(rovingNext('Enter', 1, 3)).toBe(-1)
    expect(rovingNext('ArrowRight', -1, 3)).toBe(0)
    expect(rovingNext('ArrowRight', 0, 0)).toBe(-1)
  })
})

/** Навигация «пилюлями» в экранах — устаревшее (PillTabs, Segmented kind="tab"/"nav"): новые — только Tabs. */
/** PillTabs или `kind="tab"|"nav"` именно у Segmented (до следующего тега); у Tabs `kind="nav"` — штатный API оглавления. */
const LEGACY_NAV = /<PillTabs\b|<Segmented\b(?:<[^>]*>)?(?:(?!<\/?[A-Za-z]).)*?\bkind=["'](tab|nav)["']/s
const LEGACY_NAV_ALLOW: readonly string[] = [
]

describe('экраны — вкладки, а не пилюли', () => {
  it('новых PillTabs и Segmented kind="tab"|"nav" нет (список сокращается до пустого)', () => {
    const src = fileURLToPath(new URL('../../', import.meta.url))
    const root = join(src, '..')
    const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p] })
    const hits = walk(join(src, 'features'))
      .filter((f) => /\.tsx$/.test(f) && !/\.test\.tsx$/.test(f))
      .filter((f) => LEGACY_NAV.test(readFileSync(f, 'utf8')))
      .map((f) => relative(root, f).split('\\').join('/'))
    expect(hits.filter((p) => !LEGACY_NAV_ALLOW.includes(p)), 'разделы — <Tabs>, режимы — <Segmented> (kit/index.ts)').toEqual([])
    const fixed = LEGACY_NAV_ALLOW.filter((p) => !hits.includes(p))
    if (fixed.length) console.warn(`[nav-controls] уже переведено на Tabs, удалите из списка: ${fixed.join(', ')}`)
  })
})
