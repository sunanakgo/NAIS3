import { createContext } from 'react'

/**
 * 온보딩 첫 등장 순서. 소개 로고가 조립돼 제자리에 앉으면 reveal()을 부르고, 그때부터(revealed)
 * 카드·제목·버튼·배경이 나타난다. 첫 등장이 없는 곳에선 처음부터 드러난 상태
 */
export const IntroContext = createContext<{ revealed: boolean; reveal: () => void }>({
  revealed: true,
  reveal: () => {}
})
