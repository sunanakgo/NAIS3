/** 태그 자동완성 토큰을 끊는 글자 */
export const TAG_TOKEN_SEPARATORS = /[,\n{}[\]|<>:/]/
/** 조각(`<이름>`) 자동완성 토큰을 끊는 글자 */
const FRAGMENT_TOKEN_SEPARATORS = /[<>|]/

/**
 * 추천을 띄운 토큰이 아직 커서 바로 앞에 이어져 있는지.
 *
 * 추천 패널은 입력할 때만 갱신되므로, 클릭으로 커서를 다른 줄·다른 태그로 옮기면
 * 낡은 tokenStart가 남는다. 이 상태에서 완성하면 `앞 + 태그 + 커서 뒤`가
 * tokenStart와 cursor 사이를 두 번 담아 본문이 복제된다 — 이 검사로 막는다.
 */
export function suggestionTokenAtCursor(
  text: string,
  tokenStart: number,
  cursor: number,
  kind: 'tag' | 'frag'
): boolean {
  if (tokenStart < 0 || cursor < tokenStart || cursor > text.length) return false
  const separators = kind === 'frag' ? FRAGMENT_TOKEN_SEPARATORS : TAG_TOKEN_SEPARATORS
  return !separators.test(text.slice(tokenStart, cursor))
}
