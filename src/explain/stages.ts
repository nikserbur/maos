/**
 * Единый реестр стадий реализации (X2 P-122): «реализовано / в плане · волна N» для возможностей,
 * о которых говорят и «Карта методологии» (поле `stage` узла), и «Методика» (StageChip раздела).
 * Одна запись — одна возможность: стадия, версия, в которой она появилась, и доказательство
 * (отчёт, бенчмарк, гейт). Один STAGE_META — слово, глиф и тон чипа стадии везде.
 * Правило: реализовано — ● нейтрально-хорошо; волны — ○ пунктиром, приглушённо, никогда не ▲.
 * Чистые данные — проверяются тестом (узел карты и чип раздела «Методики» совпадают).
 */

/** Стадия реализации — та же шкала, что поле `stage` узлов карты. */
export type Stage = 'done' | 'w1' | 'w2' | 'w3'

export interface StageMeta {
  /** Полная подпись чипа. */
  label: string
  /** Коротко — для узких мест (подблок на карте). */
  short: string
  glyph: '●' | '○'
  /** Тон кита: реализовано — good (глиф), волны — idle (приглушённо, пунктир). */
  tone: 'good' | 'idle'
}

export const STAGE_META: Readonly<Record<Stage, StageMeta>> = {
  done: { label: 'реализовано', short: 'реализовано', glyph: '●', tone: 'good' },
  w1: { label: 'в плане · волна 1', short: 'волна 1', glyph: '○', tone: 'idle' },
  w2: { label: 'в плане · волна 2', short: 'волна 2', glyph: '○', tone: 'idle' },
  w3: { label: 'в плане · волна 3', short: 'волна 3', glyph: '○', tone: 'idle' },
}

export const isPlannedStage = (s: Stage | undefined): boolean => Boolean(s && s !== 'done')

export interface FeatureStage {
  stage: Stage
  /** Версия продукта, в которой возможность появилась (для «в плане» — пусто). */
  version: string
  /** Что подтверждает стадию: отчёт, бенчмарк, гейт. */
  evidence: string
  /** Короткое имя возможности (подпись чипа по умолчанию). */
  title: string
}

export const FEATURES = {
  'exact-cvar': { stage: 'done', version: '0.59', title: 'точная CVaR-LP (HiGHS), двойственные цены мощностей',
    evidence: 'ExactCvar: LP Рокафеллара–Урясева, решатель HiGHS; двойственные цены в ответе портфеля' },
  'cash-lp': { stage: 'done', version: '0.64', title: 'CVaR-LP с кассой и кредитной линией',
    evidence: 'F1: водопад кассы, CFaR, P(разрыва) с ДИ Уилсона, цена ликвидности' },
  'macro-generator': { stage: 'done', version: '0.66', title: 'обученный макро-генератор',
    evidence: 'M1: VAR → SVD → HMM → блоки по рядам Банка России, CRPS и покрытие на отложенных месяцах' },
  'cpsat': { stage: 'done', version: '0.72', title: 'правило «CP-SAT», бенчмарки Taillard и Brandimarte',
    evidence: 'A2: CP-SAT достигает BKS на 18 из 20 экземпляров; тёплый старт ГА — разрыв к BKS 27,5 % → 0,01 % (Taillard)' },
  'ci': { stage: 'done', version: '0.70', title: 'ДИ и протокол доказательности',
    evidence: 'Общие случайные числа, отложенные сценарии, бутстреп-ДИ, тест Уилкоксона — гейт V5 (A1–A4)' },
  'rl': { stage: 'done', version: '0.74', title: 'RL исследован (A1–A4): гейт не пройден, правило — в продукте',
    evidence: 'A4: C* лучше в 49 из 60 экземпляров; найденное RL правило «гасить кредит излишком кассы» — в продукте' },
  'invest-agent': { stage: 'done', version: '0.73', title: 'инвестиционный агент на общих сценариях',
    evidence: 'A3: ЧДД с ДИ и CVaR кассы на тех же CRN-сценариях; внедрение только при нижней границе ДИ > 0' },
  'mentat': { stage: 'done', version: '0.74', title: 'MENTAT: промпты, контекст графа, проверка верности',
    evidence: 'L1: контекст графа расчёта, ссылка на узел в каждом утверждении, сверка чисел; модель — локальная, подключает владелец' },
  'identify': { stage: 'w1', version: '', title: 'идентификация норм по план-факту',
    evidence: 'Калибровка норм по факту и байесовское обновление паспорта — после накопления план-факта' },
  'early-warning': { stage: 'w2', version: '', title: 'раннее предупреждение по кассе и срывам',
    evidence: 'Сигналы, когда факт выходит за веер плана' },
  'games': { stage: 'w3', version: '', title: 'игры: цена анархии, Штакельберг',
    evidence: 'Игра цехов против кооператива; выученные цены планировщика против двойственных LP' },
} as const satisfies Readonly<Record<string, FeatureStage>>

export type FeatureId = keyof typeof FEATURES

export function isFeatureId(s: string): s is FeatureId {
  return Object.prototype.hasOwnProperty.call(FEATURES, s)
}

export function featureStage(id: FeatureId): Stage {
  return FEATURES[id].stage
}

/** Подпись чипа возможности: «реализовано · v0.74» или «в плане · волна 2». */
export function featureChipLabel(id: FeatureId): string {
  const f: FeatureStage = FEATURES[id]
  return f.stage === 'done' && f.version ? `${STAGE_META.done.label} · v${f.version}` : STAGE_META[f.stage].label
}
