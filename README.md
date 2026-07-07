<div align="center">

# NAIS3

<img src="build/icon-win.png" width="128" alt="NAIS3" />

**NovelAI Image Studio 3** — NovelAI 이미지 생성을 위한 데스크톱 앱

[![Discord](https://img.shields.io/badge/Discord-문의-5865F2?logo=discord&logoColor=white)](https://discord.gg/bFxP5Qvaz)
[![Patreon](https://img.shields.io/badge/Patreon-후원-FF424D?logo=patreon&logoColor=white)](https://www.patreon.com/c/sunakgo)
[![License](https://img.shields.io/badge/License-GPL--3.0-blue)](LICENSE)

</div>

---

NAIS3는 NAIS2의 후속작으로, NovelAI 이미지 생성을 빠르고 안정적으로 다룰 수 있게 만든 데스크톱 애플리케이션입니다. 수백 개의 캐릭터·프리셋을 저장하고 수만 장의 이미지를 생성하는 헤비 유저를 염두에 두고 설계했습니다.

## 주요 기능

- **생성** — 텍스트→이미지, i2i, 인페인트. NAI 웹과 바이트 단위로 동일한 payload(시드 일관성) + 실시간 스트리밍 미리보기
- **프롬프트 주석** — `#`으로 시작하는 줄은 주석으로 처리되어 전송에서 제외됩니다 (기본·캐릭터·조각 프롬프트 공통)
- **캐릭터 프롬프트** — 라이브러리로 저장·폴더 정리, 위치 지정, 동시 6명까지 활성
- **조각(와일드카드)** — `<이름>`으로 프롬프트에 삽입, 여러 줄 중 랜덤 선택
- **바이브 트랜스퍼 / 캐릭터 레퍼런스** — 이미지 라이브러리로 관리, 인코딩 캐시
- **씬 모드** — 씬별 프롬프트를 미리 저장하고 예약→일괄 생성
- **디렉터 툴** — 배경 제거·라인아트·스케치·색칠·표정 변경·이미지 정리·업스케일
- **메타데이터** — PNG/스텔스 청크에서 프롬프트·파라미터·캐릭터·UC 프리셋·퀄리티 태그 읽기
- **프롬프트 프리셋** — 자주 쓰는 프롬프트+네거티브 저장/불러오기
- **백업** — 라이브러리 전체를 JSON으로 내보내기/불러오기 (NAIS2 백업 가져오기 지원)
- **자동 업데이트** — GitHub Release 기반
- **기타** — 라이트/다크 테마, Anlas 소모 예상 표시, 태그 자동완성(작가 태그 포함), 단축키

## 다운로드

[Releases](../../releases)에서 최신 버전을 받으세요. (macOS `.dmg` / Windows `.exe`)

## 기술 스택

- [Electron](https://www.electronjs.org/) + [electron-vite](https://electron-vite.org/)
- [React](https://react.dev/) 19 + [TypeScript](https://www.typescriptlang.org/)
- [Tailwind CSS](https://tailwindcss.com/) v4
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) (로컬 DB) · [Zustand](https://github.com/pmndrs/zustand) · [sharp](https://sharp.pixelplumbing.com/)

## 개발

```bash
npm install      # 의존성 설치
npm run dev      # 개발 모드 실행
npm run build    # 타입체크 + 빌드
npm test         # 테스트

# 패키징
npm run build:mac    # macOS (.dmg)
npm run build:win    # Windows (.exe)
```

## 문의 · 후원

- 💬 **Discord**: <https://discord.gg/bFxP5Qvaz>
- ❤️ **Patreon**: <https://www.patreon.com/c/sunakgo>

## Thanks to

NovelAI API 동작을 이해하는 데 아래 프로젝트들을 참고했습니다.

- **SDStudio**
- **NAIA 2.0**

## 라이선스

이 프로젝트는 [GNU General Public License v3.0](LICENSE) 하에 배포됩니다.
