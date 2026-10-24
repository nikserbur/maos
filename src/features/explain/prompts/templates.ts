/**
 * Шаблоны задач MENTAT: чип в панели → вопрос по умолчанию, узел вопроса (центр контекста), какие
 * расчёты должны быть выполнены (`needs` — без них модель обязана ответить «нет данных», а UI заранее
 * говорит, что рассчитать) и задание модели: на какие узлы опираться и чего не делать. Версия шаблона
 * входит в версию промпта (аудит, история).
 */
import { NO_DATA } from './system'

export type Need = 'opt' | 'plan' | 'cash' | 'rl' | 'invest' | 'compare'

export interface TaskTemplate {
  id: string
  version: string
  /** Подпись чипа. */
  label: string
  /** Вопрос по умолчанию (пользователь может переписать). */
  question: string
  /** Узел вопроса по умолчанию. */
  target: string
  /** Выделенный на карте узел заменяет `target` (вопрос «об этом узле»). */
  usesFocus?: boolean
  /** Экраны, где шаблон уместен первым. */
  screens: readonly string[]
  needs: readonly Need[]
  /** Задание модели. */
  task: string
}

export const NEED_LABEL: Readonly<Record<Need, string>> = {
  opt: 'портфель Стадии 2 («Оптимизация»)',
  plan: 'план Стадии 1 («План»)',
  cash: 'расчёт кассы («План» → касса)',
  rl: 'статус политики RL («Агенты»)',
  invest: 'инвестпроект («Аналитика» → «Инвестпроекты»)',
  compare: 'прогон для сравнения (выбрать ниже)',
}

export const TEMPLATES: readonly TaskTemplate[] = [
  { id: 'why_decision', version: '1.0', label: 'Почему это решение', question: 'Почему робастный портфель именно такой?',
    target: 'dec.portfolio', screens: ['optimization', 'scenarios'], needs: ['opt'],
    task: 'Объясни, почему робастный портфель именно такой: критерий и уровень хвоста (crit.profit.*), вклады изделий в риск и прибыль (crit.profit.risk_contrib), двойственные цены мощности (dec.portfolio.duals), ограничение доли изделия. Другой портфель не предлагай.' },
  { id: 'cvar_driver', version: '1.0', label: 'Что определило CVaR', question: 'Что определило CVaR прибыли портфеля?',
    target: 'crit.profit.f.cvar', screens: ['optimization', 'scenarios'], needs: ['opt'],
    task: 'Назови узлы, которые формируют хвост прибыли: α и число сценариев N, вклады изделий в риск (узел crit.profit.risk_contrib — это доли в дисперсии прибыли, не разложение CVaR; так и говори), распределения цен и их статус паспорта. Разложение хвоста не досчитывай.' },
  { id: 'compare_runs', version: '1.0', label: 'Сравни два прогона', question: 'Чем текущий прогон отличается от выбранного для сравнения?',
    target: 'crit.profit', screens: ['optimization', 'scenarios', 'analytics'], needs: ['opt', 'compare'],
    task: 'Сравни прогоны ТОЛЬКО по узлам diff.*: какие метрики изменились и в какую сторону (поле «разность»), совпадают ли α, N и критерий (узел diff.runs). Причину различия называй, только если в diff.runs различаются входы; иначе скажи, что причина в расчёте не видна.' },
  { id: 'bottleneck', version: '1.0', label: 'Почему такое узкое место', question: 'Почему узкое место — именно этот тип станков?',
    target: 'dec.schedule.f.bottleneck', screens: ['plan', 'scheme', 'analytics'], needs: ['plan'],
    task: 'Опирайся на загрузку узкого места и фонда (plan.bottleneck, plan.utilization, мощности int.capacity), пик очереди (plan.queue_peak) и, если есть, двойственную цену фонда (dec.portfolio.duals). Не предлагай докупать оборудование — для этого есть шаблон инвестпроекта.' },
  { id: 'agent_move', version: '1.0', label: 'Объясни ход агента', question: 'Что делает первый предложенный ход агента и доказан ли его выигрыш?',
    target: 'ag.rl', screens: ['agents', 'plan'], needs: ['plan'],
    task: 'Объясни ход по узлу ag.rl.move.1 (если выделен другой ход — по нему): вид, статус, CVaR прибыли до и после, P(кассового разрыва) до и после, доля сценариев, где ход лучше, ДИ выигрыша, режим-обоснование. Если ДИ содержит 0 — скажи, что выигрыш не доказан. Если узлов ag.rl.move.* нет — ' + NO_DATA + ': ходов в плане нет.' },
  { id: 'invest_payback', version: '1.0', label: 'Окупится ли инвестпроект', question: 'Окупится ли инвестпроект и что говорит модель?',
    target: 'dec.invest', screens: ['analytics'], needs: ['invest'],
    task: 'Перескажи вердикт модели (dec.invest.cand.* — «Вердикт «внедрить»», dec.invest.base): E[ЧДД] и его 95 %-ДИ, P(ЧДД < 0), срок окупаемости, P(кассового разрыва) с проектом и без. Правило модели: внедрять только при ЧДД > 0 с нижней границей ДИ > 0 и допустимом хвосте кассы — пересказывай вердикт, своего не выноси.' },
  { id: 'crisis', version: '1.0', label: 'Что при кризисном режиме', question: 'Что будет с решением в кризисном режиме?',
    target: 'ext.regimes', screens: ['scenarios', 'optimization', 'monitoring'], needs: ['opt'],
    task: 'Отвечай ТОЛЬКО по уже посчитанному прогону: режим генератора в прогоне — узел ext.regimes.run. Если режим не «навязанный режим» и не стресс, ответ: «' + NO_DATA + ': стресс-прогон в кризисном режиме не считался» — и укажи, где его запустить (экран «Сценарии», режим генератора). Базовый прогон на кризис не переноси.' },
  { id: 'param_origin', version: '1.0', label: 'Откуда параметр', question: 'Откуда взят этот параметр и насколько ему можно верить?',
    target: 'crit.profit.alpha', usesFocus: true, screens: ['map', 'scenarios', 'nsi', 'methodology'], needs: [],
    task: 'Объясни узел вопроса: значение, статус паспорта и что он означает для доверия, на какие узлы он влияет (рёбра и parent). Для статусов К, НОРМ, UI, по умолчанию прямо скажи, что это не оценка по данным.' },
  { id: 'rl_gate', version: '1.0', label: 'Почему RL не прошёл гейт', question: 'Почему политика RL не прошла гейт и чемпион — правило?',
    target: 'ag.rl', screens: ['agents', 'plan', 'map'], needs: ['rl'],
    task: 'По узлу ag.rl.gate: какие гейты пройдены (G1, G2), ДИ выигрыша RL к лучшему правилу и к «эвристика + гасить кредит излишком кассы», кто чемпион, доступно ли правило «RL» в продукте. ДИ, содержащий 0, означает «выигрыш не доказан». Не обещай улучшений от дообучения.' },
  { id: 'cash_risk', version: '1.0', label: 'Как снизить риск разрыва', question: 'Что можно изменить, чтобы снизить риск кассового разрыва?',
    target: 'crit.cash.f.p_breach', screens: ['plan', 'optimization', 'monitoring'], needs: ['cash'],
    task: 'Перечисли ТОЛЬКО рычаги из графа — параметры и решения, связанные рёбрами с кассой (L_min и β, кредитная линия и финансовые параметры int.finance.*, портфель, расписание), с текущими значениями и статусом паспорта. Цену требования к кассе бери из dec.cash.f.pol и dec.cash.duals, если они есть. Величину эффекта не обещай и новых чисел не вводи.' },
  { id: 'makespan', version: '1.0', label: 'Почему такой E[Cmax]', question: 'Почему ожидаемая длительность плана именно такая и что её удлиняет?',
    target: 'dec.schedule.f.makespan', screens: ['plan', 'analytics'], needs: ['plan'],
    task: 'Опирайся на длительности и их хвосты (dist.durations), поломки и ТО (dist.breakdowns), загрузку узкого места (plan.bottleneck), выбранное правило и его оценку (plan.rule_score), улучшение ГА (plan.ga), если есть.' },
]

/** Свой вопрос: узел — выделенный или узел шаблона экрана; задание — общее. */
export const CUSTOM_TEMPLATE: TaskTemplate = {
  id: 'custom', version: '1.0', label: 'Свой вопрос', question: '', target: 'crit.profit', usesFocus: true, screens: [], needs: [],
  task: 'Ответь на вопрос пользователя по узлу вопроса и его окрестности в графе. Если вопрос требует прогноза, оптимизации или чисел, которых нет в расчёте, — откажись по правилу 5 и назови, какой расчёт в продукте отвечает на такой вопрос.',
}

export function getTemplate(id: string): TaskTemplate {
  return TEMPLATES.find((t) => t.id === id) ?? CUSTOM_TEMPLATE
}

/** Сколько шаблонов экрана показывать чипами сразу (X2 P-130); остальные — «Ещё вопросы (N)». */
export const OWN_TEMPLATES_MAX = 5

/** Шаблоны экрана (не больше OWN_TEMPLATES_MAX) и остальные — под раскрытием. */
export function splitTemplates(screenId: string): { own: TaskTemplate[]; more: TaskTemplate[] } {
  const own = TEMPLATES.filter((t) => t.screens.includes(screenId)).slice(0, OWN_TEMPLATES_MAX)
  return { own, more: TEMPLATES.filter((t) => !own.includes(t)) }
}

/** Шаблоны в порядке уместности для экрана (сначала свои, затем остальные — порядок реестра). */
export function templatesFor(screenId: string): TaskTemplate[] {
  const own = TEMPLATES.filter((t) => t.screens.includes(screenId))
  return [...own, ...TEMPLATES.filter((t) => !t.screens.includes(screenId))]
}

/** Узел вопроса: выделенный узел, если шаблон это допускает, иначе узел шаблона. */
export function askedNodeFor(t: TaskTemplate, focus: string | null): string {
  return t.usesFocus && focus ? focus : t.target
}

/** Каких расчётов не хватает шаблону (по доступности источников) — UI говорит, что запустить. */
export function missingNeeds(t: TaskTemplate, available: Readonly<Record<Need, boolean>>): Need[] {
  return t.needs.filter((n) => !available[n])
}

/**
 * Шаблон для узла, о котором спросили с карты или «i»: шаблон с этим узлом вопроса, для параметра —
 * «Откуда параметр», иначе «Свой вопрос» об узле.
 */
export function templateForFocus(focus: string, kind: string | undefined): string {
  const own = TEMPLATES.find((t) => t.target === focus && !t.usesFocus)
  if (own) return own.id
  return kind === 'parameter' ? 'param_origin' : CUSTOM_TEMPLATE.id
}
