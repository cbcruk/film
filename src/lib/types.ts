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
