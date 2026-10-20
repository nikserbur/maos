/**
 * «Методика» — научный лонгрид: модель, формулы, схемы, терминология,
 * верификация, конкуренты и агентный слой. Якоря: #/methodology/<id>.
 */
import { useRef, type ComponentType } from 'react'
import { TOC, sectionNumber, type SectionId } from './toc'
import { useAnchorNav } from './useAnchorNav'
import { Overview, TwoStages } from './sections/Intro'
import { CorrelationSection, ForecastSection } from './sections/External'
import { CvarSection, ParetoSection, RobustnessSection } from './sections/StageTwo'
import { DispatchSection, HeavyTailSection, Idef0Section, LotStreamingSection, MrpSection } from './sections/StageOne'
import { LittleSection, NpvSection, TocSection } from './sections/FlowInvest'
import { KpiSection, TermsSection } from './sections/Reference'
import { CompetitorsSection, ValidationSection } from './sections/Science'
import { AgentLayersSection, RlSection } from './sections/Agents'
import './methodology.css'

const SECTIONS: Record<SectionId, ComponentType> = {
  'overview': Overview,
  'two-stages': TwoStages,
  'forecast-decomposition': ForecastSection,
  'correlation-diversification': CorrelationSection,
  'cvar-tail': CvarSection,
  'price-of-robustness': RobustnessSection,
  'pareto': ParetoSection,
  'idef0': Idef0Section,
  'heavy-tail': HeavyTailSection,
  'lot-streaming': LotStreamingSection,
  'dispatch-rules': DispatchSection,
  'mrp': MrpSection,
  'toc': TocSection,
  'little-law': LittleSection,
  'npv': NpvSection,
  'kpi-definitions': KpiSection,
  'terminology': TermsSection,
  'validation': ValidationSection,
  'competitors': CompetitorsSection,
  'agent-layers': AgentLayersSection,
  'rl': RlSection,
}

export function MethodologyScreen() {
  const rootRef = useRef<HTMLDivElement>(null)
  const { active, scrollTo } = useAnchorNav(rootRef)

  const go = (id: SectionId) => {
    history.replaceState(null, '', `#/methodology/${id}`)
    scrollTo(id)
  }

  return (
    <div className="mth" ref={rootRef}>
      <div className="mth__layout">
        <nav className="mth-toc" aria-label="Оглавление методики">
          <div className="mth-toc__title text-caps">Оглавление</div>
          {TOC.map((g) => (
            <div key={g.title} className="mth-toc__group">
              <div className="mth-toc__group-title">{g.title}</div>
              {g.items.map((it) => (
                <button
                  key={it.id}
                  type="button"
                  className={`mth-toc__item${active === it.id ? ' is-active' : ''}`}
                  aria-current={active === it.id ? 'location' : undefined}
                  onClick={() => go(it.id)}
                >
                  <span className="mth-toc__num num">{sectionNumber(it.id)}</span>
                  <span>{it.title}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>

        <article className="mth__article">
          <header className="mth-hero">
            <div className="mth-hero__eyebrow text-caps">MAOS · научная основа</div>
            <h1 className="mth-hero__title">Методика</h1>
            <p className="mth-hero__lead">
              Как модель превращает справочники, сценарии рынка и технологию в робастный портфель и расписание —
              с формулами, допущениями, литературой и честной границей «реализовано / в плане».
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
