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
