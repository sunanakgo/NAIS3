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

/**
 * 커서에서 시작해 토큰이 끝나는 위치 (다음 구분자 앞, 끝 공백 제외).
 * 커서를 옮겨 띄운 추천은 그 태그를 통째로 바꾸므로 커서 뒤 나머지까지 덮는다.
 * 조각은 닫는 `>`까지 포함한다 — 완성할 때 `>`를 다시 붙이기 때문.
 */
export function suggestionTokenEnd(text: string, cursor: number, kind: 'tag' | 'frag'): number {
  let end = cursor
  if (kind === 'frag') {
    while (end < text.length && !/[<>|\n]/.test(text[end])) end++
    return text[end] === '>' ? end + 1 : end
  }
  while (end < text.length && !TAG_TOKEN_SEPARATORS.test(text[end])) end++
  while (end > cursor && /\s/.test(text[end - 1])) end--
  return end
}
