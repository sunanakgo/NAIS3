// 메인 프로세스와 렌더러가 공유하는 타입.
// 규칙: 렌더러는 이 타입들로만 메인과 대화한다 (IPC 계약).

export interface CharacterPromptInput {
  prompt: string
  negativePrompt: string
  /** 0~1 정규화 좌표. 미지정 시 NAI의 AI's choice에 맡긴다 */
  center?: { x: number; y: number }
  enabled: boolean
  /** UI 표시용 (라이브러리에서 추가한 경우) — payload에는 들어가지 않음 */
  name?: string
  thumbnail?: string
}

/**
 * UC 프리셋 인덱스 (NAI 웹 실캡처 확정): 0=Heavy, 1=Light, 3=Human Focus, 4=None. 2는 미사용.
 * 실제 병합되는 텍스트는 main/nai/payload.ts의 UC_PRESETS_V45_FULL 참조.
 */
export type UcPresetIndex = 0 | 1 | 2 | 3 | 4

/** i2i/인페인트 소스 — mask가 있으면 인페인트, 없으면 i2i */
export interface SourceImage {
  imageBase64: string
  maskBase64?: string
  strength: number
  noise: number
}

/** 레퍼런스 라이브러리 카드 공통 (바이브/캐릭레퍼) */
export interface VibeItem {
  id: number
  name: string
  thumbnail: string
  enabled: boolean
  strength: number
  infoExtracted: number
  /** 현재 infoExtracted로 인코딩돼 있는지 (아니면 생성 시 2 Anlas 소모) */
  encodedReady: boolean
  folderId: number | null
}

export type CharRefType = 'character' | 'style' | 'character&style' | 'costume' | 'delta'

export interface CharRefItem {
  id: number
  name: string
  thumbnail: string
  enabled: boolean
  refType: CharRefType
  strength: number
  fidelity: number
  folderId: number | null
}

export interface GenerationRequest {
  prompt: string
  /** Optional NAIS2-style split prompt parts. prompt is still the merged send text. */
  promptParts?: PromptParts
  negativePrompt: string
  model: string
  width: number
  height: number
  steps: number
  cfgScale: number
  cfgRescale: number
  sampler: string
  noiseSchedule: string
  seed: number
  variety: boolean
  qualityToggle: boolean
  ucPreset: UcPresetIndex
  characterPrompts: CharacterPromptInput[]
  useCoords: boolean
  /** i2i/인페인트 강도·노이즈 (소스가 있을 때 사용) */
  i2iStrength?: number
  i2iNoise?: number
  /** i2i/인페인트 모드일 때만. 바이브/캐릭레퍼는 생성 시 메인이 DB에서 enabled 항목을 읽는다 */
  source?: SourceImage
  /** 씬 생성이면 씬 id (저장 시 images.scene_id 연결) */
  sceneId?: number
}

export interface PromptParts {
  base: string
  additional: string
  detail: string
}

export type QueueItemState = 'pending' | 'generating' | 'done' | 'failed' | 'cancelled'

export interface QueueItem {
  id: string
  state: QueueItemState
  request: GenerationRequest
  error?: string
  /** 생성 완료 시 저장된 이미지 파일 경로 */
  filePath?: string
}

export interface QueueStatus {
  items: QueueItem[]
  running: boolean
  delayMs: number
}

export interface SubscriptionInfo {
  tier: 'paper' | 'tablet' | 'scroll' | 'opus'
  anlasFixed: number
  anlasPurchased: number
}

/** 캐릭터 카드 (단일 리스트 모델 — 카드가 직접 생성 포함 여부·위치를 가짐) */
export interface CharacterCard {
  id: number
  name: string
  prompt: string
  negativePrompt: string
  /** webp 썸네일 base64, 없으면 '' */
  thumbnail: string
  enabled: boolean
  center: { x: number; y: number }
  folderId: number | null
}

/** 폴더 행 (캐릭터/조각 공용 리스트 모델) */
export interface ListFolder {
  id: number
  name: string
  collapsed: boolean
  /** 구분용 색 (hex). null = 기본 (틴트 없음) */
  color: string | null
}
export type CharacterFolder = ListFolder

/** 무채색 테마에 어울리는 채도 낮은 폴더 색 프리셋 */
export const FOLDER_COLORS = [
  '#c47a72', // red
  '#c9a34f', // amber
  '#6f9e78', // green
  '#6a9e9e', // teal
  '#7089b5', // blue
  '#9080b5', // purple
  '#b57a9e', // pink
  '#8a8a90' // gray
] as const

export type CharacterCardPatch = Partial<
  Pick<CharacterCard, 'name' | 'prompt' | 'negativePrompt' | 'enabled' | 'center'>
>

/** 리스트 전체 순서 (폴더 행 + 카드 행). 카드의 폴더 소속은 이 순서에서 파생된다 */
export type CharacterOrderEntry = { type: 'folder' | 'char'; id: number }

/** 조각 프롬프트 — content는 줄 단위 와일드카드 (빈 줄·# 주석은 치환 시 제외) */
export interface Fragment {
  id: number
  name: string
  content: string
  folderId: number | null
}

export interface HistoryItem {
  id: number
  filePath: string
  /** webp 썸네일 base64 (data URL 프리픽스 없음) */
  thumbnail: string
  kind: string
  seed: number | null
  createdAt: string
}

/** 디렉터 툴 (augment-image req_type) */
export type DirectorMethod =
  | 'bg-removal'
  | 'lineart'
  | 'sketch'
  | 'colorize'
  | 'emotion'
  | 'declutter'
  | 'declutter-keep-bubbles'

/** 표정 변경 감정 목록 (웹 번들 확정) */
export const EMOTIONS = [
  'neutral',
  'happy',
  'sad',
  'angry',
  'scared',
  'surprised',
  'shy',
  'disgusted',
  'smug',
  'bored',
  'laughing',
  'irritated',
  'aroused',
  'embarrassed',
  'worried',
  'love',
  'determined',
  'hurt',
  'playful'
] as const

/** NAI PNG에서 읽은 이미지 메타데이터 (정규화) */
export interface ImageMetadata {
  prompt: string
  promptParts?: PromptParts & { negative?: string; inpainting?: string }
  negativePrompt: string
  seed?: number
  steps?: number
  cfgScale?: number
  cfgRescale?: number
  sampler?: string
  noiseSchedule?: string
  width?: number
  height?: number
  /** Source 청크 (모델명 등, 표시용) */
  model?: string
  software?: string
  variety?: boolean
  useCoords?: boolean
  /** 병합 최종본 기준 — 있으면 적용 시 프롬프트/네거티브에서 프리셋을 벗겨 재병합 */
  qualityToggle?: boolean
  ucPreset?: number
  characterPrompts?: { prompt: string; negativePrompt: string; center?: { x: number; y: number } }[]
}

/** 씬 프리셋 (씬들의 그룹) */
export interface ScenePreset {
  id: number
  name: string
  /** 새 씬 기본 해상도 (null = 832×1216) */
  defaultWidth: number | null
  defaultHeight: number | null
}

/** 프리셋에 함께 저장되는 생성 파라미터 (시드·캐릭터는 제외) */
export type PresetParams = Partial<
  Pick<
    GenerationRequest,
    | 'model'
    | 'width'
    | 'height'
    | 'steps'
    | 'cfgScale'
    | 'cfgRescale'
    | 'sampler'
    | 'noiseSchedule'
    | 'variety'
    | 'qualityToggle'
    | 'ucPreset'
  >
>

/** 프롬프트 프리셋 (기본 프롬프트+네거티브+파라미터 저장) */
export interface PromptPreset {
  id: number
  name: string
  prompt: string
  negativePrompt: string
  /** 스텝·CFG 등 — 프리셋 전환 시 함께 복원 (구버전 프리셋은 null) */
  params: PresetParams | null
}

/** 씬 (미리 저장한 프롬프트+해상도. 예약 수만큼 생성) */
export interface Scene {
  id: number
  presetId: number
  name: string
  prompt: string
  negativePrompt: string
  width: number
  height: number
  /** 예약 수 (예약→생성 워크플로. +/-로 조정) */
  reserveCount: number
  /** 목록 카드용: 최신 생성 이미지 썸네일 (없으면 '') */
  thumbnail: string
  /** 최신 생성 이미지의 원본 파일 경로 (카드에 풀해상도로 선명하게 표시. 없으면 '') */
  thumbnailPath: string
  /** 이 씬으로 생성된 이미지 수 */
  imageCount: number
}

/** 씬 상세의 생성 이미지 (페이지네이션 단위) */
export interface SceneImage {
  id: number
  filePath: string
  thumbnail: string
  seed: number | null
  favorite: boolean
}

/** 라이브러리 — 사용자가 직접 모아두는 큐레이션 이미지 (원본은 앱 내부 복사본) */
export interface LibraryImage {
  id: number
  name: string
  filePath: string
  /** webp 썸네일 base64 (없으면 '') */
  thumbnail: string
  width: number | null
  height: number | null
  stackId: number | null
}

/** 라이브러리 스택(그룹) — 카드 여러 장을 묶어 보관 */
export interface LibraryStack {
  id: number
  name: string
  count: number
  /** 스택 대표(최신) 이미지 썸네일 base64 (없으면 '') */
  coverThumbnail: string
}

/** IPC invoke 채널 계약: 채널명 → (요청, 응답) */
export interface IpcInvokeMap {
  'db:status': { req: void; res: { version: number; path: string } }
  /** 앱 버전 */
  'app:version': { req: void; res: { version: string } }
  'nai:verifyToken': {
    req: { token: string }
    res: { valid: boolean; subscription?: SubscriptionInfo; error?: string }
  }
  'nai:setToken': {
    req: { token: string }
    res: { valid: boolean; subscription?: SubscriptionInfo; error?: string }
  }
  'nai:tokenStatus': { req: void; res: { hasToken: boolean; prefix: string; length: number } }
  'nai:revealToken': { req: void; res: { token: string | null } }
  'nai:deleteToken': { req: void; res: void }
  /** 잔액 조회 (스냅샷 로그에도 기록) */
  'nai:balance': { req: void; res: { anlas: number | null; tier: string | null } }
  'nai:anlasUsage': { req: void; res: { today: number; week: number } }
  'queue:enqueue': { req: { request: GenerationRequest; count: number }; res: { ids: string[] } }
  'queue:cancel': { req: { ids: string[] }; res: void }
  'queue:status': { req: void; res: QueueStatus }
  'images:list': {
    req: { limit: number; offset: number }
    res: { items: HistoryItem[]; total: number }
  }
  'images:payload': { req: { id: number }; res: { payloadJson: string | null } }
  'settings:get': { req: { key: string }; res: { value: string | null } }
  'settings:set': { req: { key: string; value: string }; res: void }
  'window:control': { req: { action: 'minimize' | 'maximize' | 'close' }; res: void }
  /** 리사이즈 시 노출되는 네이티브 창 배경색 (테마 전환 시 갱신) */
  'window:setBackground': { req: { color: string }; res: void }
  'chars:list': { req: void; res: { folders: CharacterFolder[]; items: CharacterCard[] } }
  'chars:create': { req: { name: string; folderId: number | null }; res: { id: number } }
  'chars:update': { req: { id: number; patch: CharacterCardPatch }; res: void }
  'chars:delete': { req: { id: number }; res: void }
  'chars:duplicate': { req: { id: number }; res: { id: number } }
  /** 네이티브 파일 선택 → sharp 리사이즈 → BLOB 저장. 취소 시 thumbnail null */
  'chars:pickThumbnail': { req: { id: number }; res: { thumbnail: string | null } }
  'chars:clearThumbnail': { req: { id: number }; res: void }
  'chars:reorder': { req: { order: CharacterOrderEntry[] }; res: void }
  'chars:folderCreate': { req: { name: string }; res: { id: number } }
  'chars:folderRename': { req: { id: number; name: string }; res: void }
  'chars:folderCollapse': { req: { id: number; collapsed: boolean }; res: void }
  'chars:folderColor': { req: { id: number; color: string | null }; res: void }
  /** 폴더 삭제 — 소속 카드는 미분류로 이동 */
  'chars:folderDelete': { req: { id: number }; res: void }
  'frags:list': { req: void; res: { folders: ListFolder[]; items: Fragment[] } }
  'frags:create': { req: { name: string; folderId: number | null }; res: { id: number } }
  'frags:update': {
    req: { id: number; patch: { name?: string; content?: string } }
    res: void
  }
  'frags:delete': { req: { id: number }; res: void }
  'frags:duplicate': { req: { id: number }; res: { id: number | null } }
  'frags:importTxt': { req: void; res: { count: number } }
  'frags:exportTxt': { req: { id: number }; res: { saved: boolean } }
  /** 조각 전체를 ZIP으로 내보내기 (공유/백업) */
  'frags:exportAll': { req: void; res: { count: number } }
  /** 순차 선택(<*이름>) 카운터 전체 리셋 — 다시 처음 줄부터 (NAIS2 기능) */
  'frags:resetSequential': { req: void; res: void }
  'frags:reorder': { req: { order: CharacterOrderEntry[] }; res: void }
  'frags:folderCreate': { req: { name: string }; res: { id: number } }
  'frags:folderRename': { req: { id: number; name: string }; res: void }
  'frags:folderCollapse': { req: { id: number; collapsed: boolean }; res: void }
  'frags:folderColor': { req: { id: number; color: string | null }; res: void }
  'frags:folderDelete': { req: { id: number }; res: void }
  'tags:search': {
    req: { query: string; limit?: number }
    res: { items: { tag: string; count: number; type: string }[] }
  }
  /** T5 토큰 카운트 (V4.5 한도 512, EOS 포함 — NAI 웹과 동일 방식) */
  'tokens:count': { req: { texts: string[] }; res: { counts: number[] } }
  /** 히스토리 이미지를 i2i/인페인트 소스로 읽기 */
  'images:readForSource': {
    req: { filePath: string }
    res: { base64: string; width: number; height: number } | { error: string }
  }
  /** 파일 탐색기에서 해당 파일 위치 열기 (파일 선택 상태로) */
  'images:showInFolder': { req: { filePath: string }; res: void }
  /** 다른 이름으로 저장 — 파일 저장 다이얼로그로 복사 */
  'images:saveAs': { req: { filePath: string }; res: { saved: boolean } }
  /** 이미지를 클립보드로 복사 */
  'images:copy': { req: { filePath: string }; res: { copied: boolean } }
  /** 저장 폴더: 현재 경로 조회 / 폴더 선택 / 기본값으로 초기화 */
  /** target 생략 = main(메인 모드). 'scene' = 씬 모드 저장 폴더 */
  'settings:getSaveDir': {
    req: { target?: 'main' | 'scene' } | void
    res: { dir: string; isDefault: boolean }
  }
  'settings:pickSaveDir': { req: { target?: 'main' | 'scene' } | void; res: { dir: string | null } }
  'settings:resetSaveDir': { req: { target?: 'main' | 'scene' } | void; res: { dir: string } }
  /** 생성 지연 시간(ms) 설정 — 큐에 즉시 반영 + 영속 */
  'gen:setDelay': { req: { ms: number }; res: void }
  /** 디렉터 툴 실행 — 결과를 히스토리에 저장하고 파일 경로 + 결과 base64 반환 */
  'director:run': {
    req: { method: DirectorMethod; imageBase64: string; prompt?: string; defry?: number }
    res: { filePath: string; base64: string } | { error: string }
  }
  /** 업스케일 (2x/4x) — 결과를 히스토리에 저장하고 파일 경로 + 결과 base64 반환 */
  'images:upscale': {
    req: { imageBase64: string; scale: number }
    res: { filePath: string; base64: string } | { error: string }
  }
  /** 렌더러 로컬 편집 결과(base64 PNG)를 히스토리에 저장 — 모자이크 등 API 없는 디렉터 로컬 툴용 */
  'images:saveLocal': {
    req: { base64: string; kind: 'mosaic' }
    res: { filePath: string } | { error: string }
  }
  /** 이미지 메타데이터 읽기 (filePath는 우리 파일, base64는 외부 드롭). PNG tEXt→DB→stealth */
  'images:readMetadata': {
    req: { filePath?: string; base64?: string }
    res: { meta: ImageMetadata } | { error: string }
  }
  'scenePresets:list': { req: void; res: { items: ScenePreset[] } }
  'scenePresets:create': { req: { name: string }; res: { id: number } }
  'scenePresets:rename': { req: { id: number; name: string }; res: void }
  'scenePresets:delete': { req: { id: number }; res: void }
  'scenePresets:reorder': { req: { ids: number[] }; res: void }
  /** 프리셋의 새 씬 기본 해상도 (N3) */
  'scenePresets:setDefaultResolution': {
    req: { id: number; width: number; height: number }
    res: void
  }
  'promptPresets:reorder': { req: { ids: number[] }; res: void }
  'promptPresets:list': { req: void; res: { items: PromptPreset[] } }
  'promptPresets:create': {
    req: { name: string; prompt: string; negativePrompt: string; params?: PresetParams }
    res: { id: number }
  }
  'promptPresets:update': {
    req: {
      id: number
      patch: Partial<Pick<PromptPreset, 'name' | 'prompt' | 'negativePrompt' | 'params'>>
    }
    res: void
  }
  'promptPresets:delete': { req: { id: number }; res: void }
  /** 업데이트 다운로드 시작 (완료 시 자동 설치/재시작) */
  'update:start': { req: void; res: void }
  /** 전체 데이터 JSON 내보내기 (저장 다이얼로그) */
  'backup:export': { req: void; res: { saved: boolean } }
  /** JSON 가져오기 (열기 다이얼로그). NAIS3/NAIS2 포맷 자동 감지. summary=사람이 읽는 결과 */
  'backup:import': {
    req: void
    res: { summary: string; needsPromptReload: boolean } | { error: string } | { canceled: true }
  }
  /** 특정 프리셋의 씬 목록 */
  'scenes:list': { req: { presetId: number }; res: { items: Scene[] } }
  'scenes:create': { req: { presetId: number; name: string }; res: { id: number } }
  'scenes:get': { req: { id: number }; res: { scene: Scene | null } }
  'scenes:update': {
    req: {
      id: number
      patch: Partial<
        Pick<Scene, 'name' | 'prompt' | 'negativePrompt' | 'width' | 'height' | 'reserveCount'>
      >
    }
    res: void
  }
  'scenes:duplicate': { req: { id: number }; res: { id: number } }
  'scenes:delete': { req: { id: number }; res: void }
  'scenes:reorder': { req: { ids: number[] }; res: void }
  /** 예약: 전체 취소(count=0 등 절대값 설정) */
  'scenes:setReserveAll': { req: { presetId: number; count: number }; res: void }
  /** 예약: 전체 씬 예약 수를 delta만큼 증감 (최소 0) */
  'scenes:adjustReserveAll': { req: { presetId: number; delta: number }; res: void }
  /** 편집 모드 일괄 작업 (선택 씬 대상) */
  'scenes:bulkMove': { req: { ids: number[]; presetId: number }; res: void }
  'scenes:bulkDelete': { req: { ids: number[] }; res: void }
  'scenes:bulkSetResolution': { req: { ids: number[]; width: number; height: number }; res: void }
  'scenes:bulkClearFavorites': { req: { ids: number[] }; res: void }
  'scenes:bulkClearImages': { req: { ids: number[] }; res: { deleted: number } }
  'scenes:bulkExportZip': { req: { ids: number[] }; res: { count: number } }
  /** 씬 상세 이미지 페이지네이션 (수만 장 대비) */
  'scenes:images': {
    req: { sceneId: number; limit: number; offset: number; favoritesOnly?: boolean }
    res: { items: SceneImage[]; total: number }
  }
  /** 씬의 즐겨찾기 제외 전체 삭제 (파일 포함) */
  'scenes:deleteNonFavorites': { req: { sceneId: number }; res: { deleted: number } }
  'images:setFavorite': { req: { id: number; favorite: boolean }; res: void }
  /** 이미지 삭제 — deleteFile=true면 파일까지(씬 상세), 아니면 기록만(히스토리, 파일 보존) */
  'images:delete': { req: { id: number; deleteFile?: boolean }; res: void }
  /** 히스토리 전체 비우기 (레코드+파일, 씬 이미지 포함) */
  'images:clearAll': { req: void; res: { count: number } }
  /** 씬 이미지 폴더 열기 (NAIS3_scene/<프리셋>/<씬>) */
  'scenes:openFolder': { req: { sceneId: number }; res: { ok: boolean } }
  /** 씬 JSON 내보내기/불러오기 (파일 다이얼로그, 활성 프리셋 기준) */
  'scenes:exportJson': { req: { presetId: number }; res: { saved: boolean } }
  'scenes:importJson': { req: { presetId: number }; res: { count: number } }
  /** 즐겨찾기 이미지 또는 각 씬 최상단 이미지를 ZIP으로 (파일 다이얼로그) */
  'scenes:exportZip': { req: { mode: 'favorites' | 'sceneTop' }; res: { count: number } }
  'vibes:list': { req: void; res: { folders: ListFolder[]; items: VibeItem[] } }
  /** 파일 다이얼로그(다중)로 추가 */
  'vibes:add': { req: { folderId: number | null }; res: { count: number } }
  'vibes:update': {
    req: {
      id: number
      patch: Partial<Pick<VibeItem, 'name' | 'enabled' | 'strength' | 'infoExtracted'>>
    }
    res: void
  }
  'vibes:delete': { req: { id: number }; res: void }
  'vibes:reorder': { req: { order: CharacterOrderEntry[] }; res: void }
  'vibes:folderCreate': { req: { name: string }; res: { id: number } }
  'vibes:folderRename': { req: { id: number; name: string }; res: void }
  'vibes:folderCollapse': { req: { id: number; collapsed: boolean }; res: void }
  'vibes:folderColor': { req: { id: number; color: string | null }; res: void }
  'vibes:folderDelete': { req: { id: number }; res: void }
  'crefs:list': { req: void; res: { folders: ListFolder[]; items: CharRefItem[] } }
  'crefs:add': { req: { folderId: number | null }; res: { count: number } }
  'crefs:update': {
    req: {
      id: number
      patch: Partial<Pick<CharRefItem, 'name' | 'enabled' | 'refType' | 'strength' | 'fidelity'>>
    }
    res: void
  }
  'crefs:delete': { req: { id: number }; res: void }
  'crefs:reorder': { req: { order: CharacterOrderEntry[] }; res: void }
  'crefs:folderCreate': { req: { name: string }; res: { id: number } }
  'crefs:folderRename': { req: { id: number; name: string }; res: void }
  'crefs:folderCollapse': { req: { id: number; collapsed: boolean }; res: void }
  'crefs:folderColor': { req: { id: number; color: string | null }; res: void }
  'crefs:folderDelete': { req: { id: number }; res: void }

  /** 라이브러리 — stackId 미지정=루트(스택 목록 + 미분류 이미지), 지정=해당 스택 내부 */
  'library:list': {
    req: { stackId?: number | null; limit: number; offset: number }
    res: { items: LibraryImage[]; stacks: LibraryStack[]; total: number }
  }
  /** 파일 다이얼로그(다중)로 가져오기 — 라이브러리 폴더에 복사 + 썸네일 생성 */
  'library:import': { req: { stackId?: number | null }; res: { count: number } }
  /** 앱 내부 이미지 경로(히스토리 드래그 등)로 가져오기 */
  'library:importPaths': {
    req: { filePaths: string[]; stackId?: number | null }
    res: { count: number }
  }
  /** 외부 드롭(base64)으로 가져오기 */
  'library:importImages': {
    req: { images: { name: string; base64: string }[]; stackId?: number | null }
    res: { count: number }
  }
  /** 삭제 — DB 행 + 복사본 파일 모두 */
  'library:delete': { req: { ids: number[] }; res: void }
  /** 드래그 정렬 — 로드된 이미지 id들의 새 순서 (기존 슬롯 재배분) */
  'library:reorder': { req: { ids: number[] }; res: void }
  'library:stackCreate': { req: { name: string; imageIds: number[] }; res: { id: number } }
  'library:stackRename': { req: { id: number; name: string }; res: void }
  /** 스택 삭제 — 소속 이미지는 미분류로 (이미지 삭제 아님) */
  'library:stackDelete': { req: { id: number }; res: void }
  /** 이미지들을 스택에 넣기/빼기 (stackId null = 해제) */
  'library:stackSet': { req: { imageIds: number[]; stackId: number | null }; res: void }
}

/** 메인 → 렌더러 이벤트 채널 */
export interface IpcEventMap {
  'queue:changed': QueueStatus
  /** 생성 완료 등으로 잔액이 갱신될 때 */
  'anlas:balance': { anlas: number }
  'generation:progress': {
    id: string
    stepIx: number
    totalSteps: number
    /** 중간 미리보기 PNG base64 (없을 수 있음) */
    previewPng?: string
  }
  /** 씬에 새 이미지가 생성됨 (목록/상세 갱신). filePath로 카드 즉시 낙관적 갱신 */
  'scenes:changed': { sceneId: number; filePath: string }
  /** 바이브 인코딩 완료 — 카드의 인코딩 표시 갱신용 */
  'vibes:encoded': Record<string, never>
  /** 자동 업데이트 상태 (GitHub release) */
  'update:status': {
    state: 'available' | 'none' | 'downloading' | 'downloaded' | 'error'
    version?: string
    percent?: number
    message?: string
  }
}
