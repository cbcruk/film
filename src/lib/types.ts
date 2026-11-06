// 클라이언트·서버 공용 타입. Effect를 import하지 않는다.

export type ErrorCode =
  | 'FFMPEG_MISSING'
  | 'LIBRARY_NOT_FOUND'
  | 'FILE_NOT_FOUND'
  | 'NOT_A_VIDEO'
  | 'EXTRACT_FAILED'
  | 'TIMEOUT'
  | 'INVALID_PARAM'
  | 'INTERNAL'

export interface ErrorBody {
  readonly code: ErrorCode
  readonly message: string
}

export interface Health {
  readonly ffmpeg: string | null
  readonly filmDir: string
  readonly filmDirExists: boolean
  /** 저장 가능한 포맷 (설치된 ffmpeg 인코더 기준) */
  readonly formats: ReadonlyArray<FrameFormat>
}

/** listVideos 항목. folder는 FILM_DIR 기준 상대 폴더 (최상위면 "") */
export interface VideoEntry {
  readonly id: string
  readonly name: string
  readonly folder: string
  readonly size: number
  readonly mtime: string
}

/** ffprobe 결과. width/height는 회전을 반영한 표시 크기 */
export interface VideoMeta {
  readonly duration: number
  readonly width: number
  readonly height: number
  readonly fps: number
  readonly codec: string
}

export type FrameFormat = 'png' | 'jpg' | 'webp'

/** listVideos 결과 */
export interface VideoList {
  readonly dir: string
  readonly videos: ReadonlyArray<VideoEntry & { readonly cached: boolean }>
}

export type ThumbCount = 6 | 12 | 24 | 48

/** openSource 결과. times는 세트의 시점 목록 (스켈레톤 카드·타임코드 표시용) */
export interface SourceInfo extends VideoMeta {
  readonly id: string
  readonly name: string
  readonly setId: string
  readonly times: ReadonlyArray<number>
  /** 구간 재생성 세트면 그 구간 (전체 세트면 없음) */
  readonly range?: { readonly from: number; readonly to: number }
}

/** 썸네일 한 장 재시도 결과 */
export type RetryResult =
  | Extract<SourceEvent, { type: 'thumb' }>
  | (Extract<SourceEvent, { type: 'error' }> & { readonly index: number })

/** SSE 이벤트 (event 이름 = type) */
export type SourceEvent =
  | {
      readonly type: 'thumb'
      readonly setId: string
      readonly index: number
      readonly t: number
      readonly url: string
    }
  | {
      readonly type: 'progress'
      readonly setId: string
      readonly done: number
      readonly total: number
    }
  | { readonly type: 'done'; readonly setId: string }
  | {
      readonly type: 'error'
      readonly setId: string
      readonly index?: number
      readonly code: ErrorCode
      readonly message: string
    }
