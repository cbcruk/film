import '@tanstack/react-start/server-only'
import { Schema } from 'effect'
import type { ErrorBody, ErrorCode } from '../lib/types.ts'

export class FfmpegMissing extends Schema.TaggedError<FfmpegMissing>()(
  'FfmpegMissing',
  { message: Schema.String },
) {}

export class LibraryNotFound extends Schema.TaggedError<LibraryNotFound>()(
  'LibraryNotFound',
  { message: Schema.String, dir: Schema.String },
) {}

export class FileNotFound extends Schema.TaggedError<FileNotFound>()(
  'FileNotFound',
  { message: Schema.String },
) {}

export class NotAVideo extends Schema.TaggedError<NotAVideo>()('NotAVideo', {
  message: Schema.String,
}) {}

export class ExtractFailed extends Schema.TaggedError<ExtractFailed>()(
  'ExtractFailed',
  { message: Schema.String, t: Schema.Number },
) {}

export class FfmpegTimeout extends Schema.TaggedError<FfmpegTimeout>()(
  'FfmpegTimeout',
  { message: Schema.String },
) {}

export class InvalidParam extends Schema.TaggedError<InvalidParam>()(
  'InvalidParam',
  { message: Schema.String },
) {}

export type AppError =
  | FfmpegMissing
  | LibraryNotFound
  | FileNotFound
  | NotAVideo
  | ExtractFailed
  | FfmpegTimeout
  | InvalidParam

// 11절 에러 코드표. 태그를 추가하면 여기서 타입 에러가 나므로 누락되지 않는다.
const table: Record<AppError['_tag'], { code: ErrorCode; status: number }> = {
  FfmpegMissing: { code: 'FFMPEG_MISSING', status: 503 },
  LibraryNotFound: { code: 'LIBRARY_NOT_FOUND', status: 503 },
  FileNotFound: { code: 'FILE_NOT_FOUND', status: 404 },
  NotAVideo: { code: 'NOT_A_VIDEO', status: 415 },
  ExtractFailed: { code: 'EXTRACT_FAILED', status: 500 },
  FfmpegTimeout: { code: 'TIMEOUT', status: 504 },
  InvalidParam: { code: 'INVALID_PARAM', status: 400 },
}

export const toErrorBody = (error: AppError): ErrorBody => ({
  code: table[error._tag].code,
  message: error.message,
})

export const toStatus = (error: AppError): number => table[error._tag].status
