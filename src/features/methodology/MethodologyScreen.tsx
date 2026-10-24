/**
 * «Методика» — научный лонгрид: модель, формулы, схемы, терминология, верификация, конкуренты и
 * агентный слой. Якоря: #/methodology/<id>. Оглавление — настоящие ссылки (X2 P-132): Cmd/Ctrl+клик
 * открывает раздел в новой вкладке, «Назад» возвращает к прежнему разделу.
 */
import { useRef } from 'react'
import { TOC, sectionNumber } from './toc'
import { useAnchorNav } from './useAnchorNav'
import { SECTIONS } from './sections'
import './methodology.css'

export function MethodologyScreen() {
  const rootRef = useRef<HTMLDivElement>(null)
  const { active } = useAnchorNav(rootRef)

  return (
    <div className="mth" ref={rootRef}>
      <div className="mth__layout">
        <nav className="mth-toc" aria-label="Оглавление методики">
          <div className="mth-toc__title text-caps">Оглавление</div>
          {TOC.map((g) => (
            <div key={g.title} className="mth-toc__group">
              <div className="mth-toc__group-title">{g.title}</div>
              {g.items.map((it) => (
                <a
                  key={it.id}
                  href={`#/methodology/${it.id}`}
                  className={`mth-toc__item${active === it.id ? ' is-active' : ''}`}
                  aria-current={active === it.id ? 'location' : undefined}
                >
                  <span className="mth-toc__num num">{sectionNumber(it.id)}</span>
                  <span>{it.title}</span>
                </a>
              ))}
            </div>
          ))}
        </nav>

        <article className="mth__article">
          <header className="mth-hero">
            <div className="mth-hero__eyebrow text-caps">Объяснение · научная основа</div>
            <h1 className="mth-hero__title">Методика</h1>
            <p className="mth-hero__lead">
              Как модель превращает справочники, сценарии рынка и технологию в робастный портфель и расписание —
              с формулами, допущениями, литературой и честной границей «реализовано / в плане».
              Каждый раздел ссылается на свои узлы <a href="#/map">«Карты методологии»</a>.
            </p>
          </header>
          {TOC.flatMap((g) => g.items).map((it) => {
            const S = SECTIONS[it.id]
            return <S key={it.id} />
          })}
        </article>
      </div>
    </div>
  )
}

export default MethodologyScreen
