/** Разделы «Стадия 1 · расписание»: IDEF0, хвосты, транспортные партии, правила, MRP. */
import { Callout, Figure, Formula, Notes, Refs, Section } from '../blocks'

export function Idef0Section() {
  return (
    <Section
      id="idef0"
      stages={[
        ['done', 'редактор маршрута в нотации IDEF0 (линейная цепочка)'],
        ['w1', 'граф процесса: сырьё → операция → полуфабрикат → изделие (DAG)'],
      ]}
      lead={<>Маршрутная карта изделия — последовательность функций. В IDEF0 каждая операция — блок с четырьмя видами
        стрелок ICOM: вход, управление, выход, механизм.</>}
    >
      <p><b>Входы (I)</b> — сырьё и полуфабрикаты (<code>operation_inputs</code>); <b>управления (C)</b> —
        производственная программа, сроки, техкарта, нормы времени, календарь; <b>механизмы (M)</b> — станки
        допустимого типа РЦ (<code>operation_wc_types</code>) и рабочие нужной квалификации; <b>выходы (O)</b> — изделие
        или полуфабрикат и данные о выполнении. Контекстная диаграмма A-0 содержит единственный блок A0, который
        декомпозируется на A1…An.</p>
      <Figure id="idef0" caption="Управления входят сверху (пунктир — информация), входы слева, выходы справа, механизмы ■ снизу; номер узла — в правом нижнем углу." />
      <Callout tone="note" title="Ограничения текущего редактора">
        Маршрут — строгая цепочка с одним типом РЦ на операцию; C и M — свободные текстовые теги без семантики.
        Редактор сохраняет t<sub>opt</sub> = t<sub>norm</sub> = t<sub>pess</sub>, и σ длительности молча становится 15 % —
        тяжёлый хвост здесь задать нельзя; правка пересоздаёт маршрут с новыми id. Граф процесса (Волна 1) заменяет
        цепочку на ориентированный ациклический граф со сборкой и ветвлением.
      </Callout>
      <Refs items={[
        'FIPS PUB 183 (1993) Integration Definition for Function Modeling (IDEF0). NIST.',
        'Р 50.1.028-2001. Информационные технологии поддержки жизненного цикла продукции. Методология функционального моделирования.',
        'ГОСТ 3.1118-82. ЕСТД. Формы и правила оформления маршрутных карт; ГОСТ 3.1109-82. ЕСТД. Термины и определения.',
      ]} />
    </Section>
  )
}

export function HeavyTailSection() {
  return (
    <Section
      id="heavy-tail"
      stages={[
        ['done', 'логнормаль + Парето-примесь + переделка (sample_dur), Монте-Карло с CRN'],
        ['w2', 'подгонка к факту (MLE/AIC), разделение эпистемического и пакетного шума'],
      ]}
      lead={<>Редкие длинные задержки — поломка, переделка, ожидание — доминируют в риске срыва срока. Поэтому
        длительность операции моделируется распределением с тяжёлым правым хвостом.</>}
    >
      <Formula note="w = tail_weight, a = tail_index, r = risk_coef операции; Z ~ N(0, 1), Uᵢ ~ U(0, 1).">
        t̄ = (a<sub>min</sub> + 4m + b<sub>max</sub>)/6,{'  '}σ = (b<sub>max</sub> − a<sub>min</sub>)/6,{'  '}
        σ<sub>ln</sub>² = ln(1 + (σ/t̄)²),{'  '}μ = ln t̄ − σ<sub>ln</sub>²/2
        <br />
        t = e<sup>μ + σ<sub>ln</sub>Z</sup> · M<sup>[U₁ &lt; w]</sup> + 0,5·t̄·[U₂ &lt; r],{'  '}M = min(9, U₃<sup>−1/a</sup>)
      </Formula>
      <p>Следствие: E[t] &gt; t̄, а значит E[C<sub>max</sub>] больше длины детерминированного расписания на нормативах —
        оно систематически оптимистично. Поэтому KPI «Длина расписания» — это E[C<sub>max</sub>] по Монте-Карло на
        итоговом расписании. Ограничение 9× делает конечными все моменты:
        E[M] = (a − 9<sup>1−a</sup>)/(a − 1).</p>
      <Figure id="heavy-tail" caption="800 сэмплов по алгоритму sample_dur: тело — логнормаль, киноварь — Парето-хвост до предела 9×; точки под осью — каждый сэмпл." />
      <Callout tone="fix" title="Поправка: это не β-PERT">
        PERT-моменты лишь задают среднее и σ логнормали; прежнее описание «β-PERT» неверно. Корректно — «логнормаль с
        примесью ограниченного Парето и переделкой». Строго говоря, min(9, ·) — цензурирование: P(M = 9) = 9<sup>−a</sup>.
        PERT-аппроксимации смещены (Keefer &amp; Verdini, 1993), поэтому параметры следует оценивать по фактическим данным.
      </Callout>
      <Notes items={[
        'Константы требуют обоснования или вывода в параметры: предел 9×, переделка +0,5·t̄, интенсивность отказов λ = (0,5 + 1,5u)/MTBF, коэффициент вариации ремонта 0,6.',
        'Стандартная модель отказов — наработка по Вейбуллу и логнормальный ремонт (ГОСТ 27.002-2015); сейчас — не более одного отказа на операцию.',
        'Генераторы std::*_distribution зависят от реализации: результаты macOS и Linux при одном seed различаются.',
      ]} />
      <Refs items={[
        'Malcolm D., Roseboom J., Clark C., Fazar W. (1959) Application of a technique for research and development program evaluation. Oper. Res. 7(5):646–669.',
        'Keefer D., Verdini W. (1993) Better estimation of PERT activity time parameters. Management Science 39(9):1086–1091.',
        'Resnick S. (2007) Heavy-Tail Phenomena: Probabilistic and Statistical Modeling. Springer.',
        'ГОСТ 27.002-2015. Надёжность в технике. Термины и определения.',
      ]} />
    </Section>
  )
}

export function LotStreamingSection() {
  return (
    <Section
      id="lot-streaming"
      stages={[
        ['done', 'равные согласованные подпартии, N = min(16, q / размер партии)'],
        ['w1', 'стыковка по последней нужной подпартии входа (B1)'],
        ['w2', 'переменные подпартии в CP-модели'],
      ]}
      lead={<>Партии не обязательно ждать целиком: транспортные подпартии сразу уходят на следующую операцию,
        операции перекрываются, и производственный цикл сокращается.</>}
    >
      <Formula note="Два станка, N равных подпартий, без времени транспортировки.">
        C<sub>seq</sub> = q·(p<sub>1</sub> + p<sub>2</sub>),{'  '}
        C<sub>ls</sub> = (q/N)·(p<sub>1</sub> + p<sub>2</sub>) + (N − 1)·(q/N)·max(p<sub>1</sub>, p<sub>2</sub>)
      </Formula>
      <p>Подпартия k операции маршрута ждёт подпартию k предыдущей операции. Если вход BOM нарезан на L подпартий, а
        потребитель — на N, подпартии k нужны единицы входа до ⌈(k+1)·q/N⌉, то есть она должна ждать последнюю из них:</p>
      <Formula>j*(k) = ⌈(k + 1)·L / N⌉ − 1</Formula>
      <Figure id="lot-streaming" caption="Сверху — передача целиком (14 ч), в середине — 4 подпартии (9,5 ч, заливка — выигрыш), снизу — стыковка разных партий и ошибочный ранний старт." />
      <Callout tone="fix" title="Исправление B1 (Волна 1)">
        Раньше потребитель ждал подпартию ⌊k·L/N⌋ — <i>первую</i> из нужных ему. При L &gt; N (разные размеры партий или
        потолок 16) он стартовал раньше, чем существовали его входы, и длина расписания получалась оптимистичной.
      </Callout>
      <Refs items={[
        'Trietsch D., Baker K. (1993) Basic techniques for lot streaming. Oper. Res. 41(6).',
        'Chang J., Chiu H. (2005) A comprehensive review of lot streaming. Int. J. Production Research 43(7).',
      ]} />
    </Section>
  )
}

export function DispatchSection() {
  return (
    <Section
      id="dispatch-rules"
      stages={[
        ['done', '7 статических правил, конструктор CUSTOM, локальный поиск 30 итераций'],
        ['w2', 'ATC/COVERT, эталон CP-SAT, бенчмарки Taillard и Brandimarte'],
        ['w3', 'обучаемый диспетчер (RL)'],
      ]}
      lead={<>Правило задаёт приоритет операций, а списочный алгоритм ставит каждую на самый ранний допустимый момент.
        Правила дёшевы и объяснимы, но оптимальны лишь в частных случаях.</>}
    >
      <Formula note="rem — остаток работы по цепочке вперёд (критический путь); ключи вычисляются один раз.">
        SPT: min p̄<sub>j</sub>;{'  '}EDD: min d<sub>j</sub>;{'  '}CR: min d<sub>j</sub>/max(1, rem<sub>j</sub>);{'  '}
        MWKR: max rem<sub>j</sub>;{'  '}MS: min (d<sub>j</sub> − rem<sub>j</sub>)
        <br />
        rem<sub>j</sub> = p̄<sub>j</sub> + max<sub>s ∈ succ(j)</sub> rem<sub>s</sub>
      </Formula>
      <p>Классика для одного станка: SPT оптимально для ΣC<sub>j</sub> (Smith, 1956), EDD минимизирует максимальное
        запаздывание (Jackson, 1955), а задача 1‖ΣT<sub>j</sub> NP-трудна (Du &amp; Leung, 1990) — универсально лучшего
        правила нет. В MAOS все правила прогоняются на одних и тех же сценариях (CRN), выбирается лучшее по F, затем
        локальный поиск возмущает ключи приоритета.</p>
      <Figure id="dispatch-rules" caption="Четыре операции на одном станке в порядке четырёх правил; красное — просрочка Cⱼ − dⱼ, ▲ — лучшее значение ΣC и ΣT." />
      <Callout tone="fix" title="Поправка: расписание полуактивное">
        Операции добавляются в конец занятости станка без вставки в окна — расписание <b>полуактивное</b>, а не
        «активное». CR и MS статические (без текущего момента). Локальный поиск оценивается на первых 30 сценариях —
        тех же, что идут в отчёт (in-sample); нужна отложенная выборка.
      </Callout>
      <Refs items={[
        'Jackson J.R. (1955) Scheduling a production line to minimize maximum tardiness. Research Report 43, Management Science Research Project, UCLA.',
        'Smith W.E. (1956) Various optimizers for single-stage production. Naval Res. Logist. Q. 3(1–2):59–66.',
        'Du J., Leung J.Y.-T. (1990) Minimizing total tardiness on one machine is NP-hard. Math. Oper. Res. 15(3):483–495.',
        'Panwalkar S., Iskander W. (1977) A survey of scheduling rules. Oper. Res. 25(1):45–61.',
        'Giffler B., Thompson G. (1960) Algorithms for solving production-scheduling problems. Oper. Res. 8(4):487–503.',
      ]} />
    </Section>
  )
}

export function MrpSection() {
  return (
    <Section
      id="mrp"
      stages={[
        ['done', 'нетто-расчёт по кодам нижнего уровня, кратность партии, страховой запас'],
        ['w1', 'смещение на срок изготовления партии (B14)'],
      ]}
      lead={<>MRP переводит потребность в изделиях в потребность в компонентах по периодам: от валовой потребности к
        чистой, затем к партиям и датам запуска.</>}
    >
      <Formula note="SR — уже запущенные поступления; валовая потребность компонента = план. запуск родителя × норма расхода.">
        NR<sub>t</sub> = max(0, GR<sub>t</sub> + SS − OH<sub>t−1</sub> − SR<sub>t</sub>),{'  '}
        PORc<sub>t</sub> = ⌈NR<sub>t</sub>/Q⌉·Q,{'  '}PORel<sub>t−LT</sub> = PORc<sub>t</sub>
        <br />
        OH<sub>t</sub> = OH<sub>t−1</sub> + SR<sub>t</sub> + PORc<sub>t</sub> − GR<sub>t</sub>,{'  '}
        LT = ⌈(t<sub>нал</sub> + Q·t<sub>ед</sub>/K) / T<sub>периода</sub>⌉
      </Formula>
      <Figure id="mrp" caption="Запись MRP: чистая потребность покрывается партиями по 40, запуск ▲ смещён на срок изготовления партии LT = 2 периода." />
      <Callout tone="fix" title="Исправление B14 (Волна 1)">
        Раньше смещение равнялось времени обработки <i>одной единицы</i>, а не партии (и без деления на число параллельных
        станков K): даты запуска выходили слишком поздними, флаги «опаздывает» пропускались.
      </Callout>
      <Refs items={[
        'Orlicky J. (1975) Material Requirements Planning. McGraw-Hill.',
        'Hopp W., Spearman M. (2008) Factory Physics, 3rd ed. McGraw-Hill.',
      ]} />
    </Section>
  )
}
