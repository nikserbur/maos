/** Разделы «Методики» по якорю: один реестр для экрана и для теста «узел карты ↔ чип раздела». */
import type { ComponentType } from 'react'
import type { SectionId } from '../toc'
import { Overview, TwoStages } from './Intro'
import { CorrelationSection, ForecastSection } from './External'
import { CvarSection, ParetoSection, RobustnessSection } from './StageTwo'
import { DispatchSection, HeavyTailSection, Idef0Section, LotStreamingSection, MrpSection } from './StageOne'
import { LittleSection, NpvSection, TocSection } from './FlowInvest'
import { KpiSection, TermsSection } from './Reference'
import { CompetitorsSection, ValidationSection } from './Science'
import { AgentLayersSection, RlSection } from './Agents'

export const SECTIONS: Readonly<Record<SectionId, ComponentType>> = {
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
