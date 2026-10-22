/**
 * «Агенты» — зарезервированный экран блока [6] (решение владельца, UX-V2 §8 п. 6):
 * RL L0/L2 со структурными ходами, guardrails, цена анархии, Штакельберг.
 * До волны A/G4 — честное состояние «в плане» в языке дизайн-системы (как чипы
 * «Волна 3» в «Методике»), без заглушечного текста: что будет, откуда читать, куда идти.
 */
import { methodologyHref } from '../../explain/anchors'
import { EmptyState, ScreenHeader, StatusChip, rise } from '../../ui/kit'
import './agents.css'

const COMING: ReadonlyArray<{ title: string; what: string; where: string; how?: string }> = [
  { title: 'Правило «RL» рядом с EDD/SPT', what: 'Политика L0/L2 сравнивается с ГА и правилами на одних сценариях, с ДИ — как карточка ГА.', where: 'План · шаг «Цель и риск»',
    how: 'В списке правил «Плана» появится четвёртая строка рядом с EDD и SPT: тот же Гант, те же KPI, то же сравнение «до → после».' },
  { title: 'Структурные ходы', what: 'Маршрут, станок, партии, цех, аутсорсинг, сдвиг запуска, отказ от заказа — каждый с «до → после» по CVaR прибыли и кассы.', where: 'План · результат · «ходы агента»' },
  { title: 'Полномочия агента', what: 'Разрешённые ходы с масками, лимиты пакета, заморозки, единый α на всех экранах.', where: 'здесь и в панели узла [6] на карте' },
  { title: 'Игры', what: 'Цена анархии стимулов цехов; Штакельберг «банк/поставщик → предприятие»; выученные цены против двойственных LP.', where: 'здесь' },
]

const [lead, ...rest] = COMING

export function AgentsStub() {
  return (
    <div className="agents">
      <ScreenHeader
        eyebrow="Блок [6] · агенты и игры"
        title="Агенты"
        subtitle="Агент предлагает, человек утверждает, обе стороны видят одни и те же сценарии. Экран появится вместе с обученной политикой (волна 3)."
        actions={<StatusChip tone="idle">волна 3 · в плане</StatusChip>}
      />
      <EmptyState
        title="Политика ещё не обучена"
        diagram="agent-layers"
        action={
          <>
            <a className="btn btn--primary" href="#/map/ag.rl">Узел [6] на карте</a>
            <a className="btn" href={methodologyHref('rl')}>RL в «Методике»</a>
          </>
        }
      >
        Среда-симулятор, Python-стенд и базовые линии (CP-SAT) — волна A; до них блок [6] на карте
        методологии показан пунктиром, а правило «RL» в «Плане» не предлагается.
      </EmptyState>
      <section className="agents__plan" aria-label="Что появится на экране">
        <article className="dk-card agents__lead dk-rise" style={rise(1)}>
          <p className="text-caps agents__where">{lead.where}</p>
          <h3 className="agents__lead-title">{lead.title}</h3>
          <p className="agents__lead-what">{lead.what}</p>
          {lead.how && <p className="agents__how">{lead.how}</p>}
        </article>
        <ol className="agents__list">
          {rest.map((item, i) => (
            <li key={item.title} className="agents__item dk-rise" style={rise(i + 2)}>
              <span className="agents__n mono" aria-hidden="true">{i + 2}</span>
              <div className="agents__body">
                <h3 className="agents__title">{item.title}</h3>
                <p className="agents__what">{item.what}</p>
              </div>
              <p className="text-caps agents__where agents__item-where">{item.where}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}
