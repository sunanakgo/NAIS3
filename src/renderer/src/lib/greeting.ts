import type { MessageId } from '@shared/i18n'

export type DayPart = 'dawn' | 'morning' | 'afternoon' | 'evening' | 'night'

/** 로컬 시각(시) → 시간대. 새벽 0–5 · 아침 5–12 · 오후 12–17 · 저녁 17–21 · 밤 21–24 */
export function dayPartOf(hour: number): DayPart {
  if (hour < 5) return 'dawn'
  if (hour < 12) return 'morning'
  if (hour < 17) return 'afternoon'
  if (hour < 21) return 'evening'
  return 'night'
}

const ids = (part: string): readonly MessageId[] =>
  [1, 2, 3, 4, 5, 6].map((n) => `ui.greeting${part}${n}` as MessageId)

const GREETINGS: Record<DayPart, readonly MessageId[]> = {
  dawn: ids('Dawn'),
  morning: ids('Morning'),
  afternoon: ids('Afternoon'),
  evening: ids('Evening'),
  night: ids('Night')
}

/** 시간대별 인사 문구 ID. pick(0 이상 1 미만)으로 변형 중 하나를 고른다 */
export function greetingFor(hour: number, pick: number): MessageId {
  const options = GREETINGS[dayPartOf(hour)]
  return options[Math.min(options.length - 1, Math.floor(pick * options.length))]
}
