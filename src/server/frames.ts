import '@tanstack/react-start/server-only'
import path from 'node:path'
import { Effect, Option, Stream } from 'effect'
import type { FrameFormat } from '../lib/types.ts'
import { Cache } from './cache.ts'
import { InvalidParam } from './errors.ts'
import { Ffmpeg } from './ffmpeg.ts'
import { Library } from './library.ts'

const CONTENT_TYPES: Record<FrameFormat, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
}

const isFrameFormat = (ext: string): ext is FrameFormat => ext in CONTENT_TYPES

export interface Frame {
  readonly bytes: Uint8Array
  readonly contentType: string
  readonly filename: string
}

/**
 * 원본 해상도 프레임 한 장.
 * 이미지 하나를 다 받은 뒤 돌려준다 — 헤더를 보낸 뒤 ffmpeg가 실패하면 깨진 이미지가 되므로,
 * 실패는 상태 코드로 알린다. 요청이 끊기면 인터럽트되어 ffmpeg도 종료된다.
 */
export const extractFrame = Effect.fn('extractFrame')(function* (input: {
  readonly id: string
  readonly t: number
  readonly filename: string
}) {
  const invalid = (message: string) => new InvalidParam({ message })

  const { filename } = input
  if (/[/\\]/.test(filename) || filename.startsWith('.')) {
    return yield* invalid('파일명에 경로를 넣을 수 없습니다')
  }
  const ext = path.extname(filename).slice(1).toLowerCase()
  if (!isFrameFormat(ext)) {
    return yield* invalid('확장자는 png · jpg · webp 중 하나여야 합니다')
  }

  const ffmpeg = yield* Ffmpeg
  if (!(yield* ffmpeg.formats).includes(ext)) {
    return yield* invalid(`이 ffmpeg로는 ${ext}를 만들 수 없습니다`)
  }

  const file = yield* (yield* Library).resolve(input.id)
  const cached = yield* (yield* Cache).readMeta(input.id)
  const meta = Option.isSome(cached)
    ? cached.value.meta
    : yield* ffmpeg.probe(file)
  if (input.t >= meta.duration) {
    return yield* invalid(`시점이 영상 길이(${meta.duration}초)를 넘습니다`)
  }

  const chunks = yield* Stream.runCollect(ffmpeg.frame(file, input.t, ext))
  const frame: Frame = {
    bytes: Buffer.concat(Array.from(chunks)),
    contentType: CONTENT_TYPES[ext],
    filename,
  }
  return frame
})

/** `inline; filename="ascii"; filename*=UTF-8''원본` — 한글 파일명도 저장 창에 그대로 뜨게 */
export const contentDisposition = (filename: string) => {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}
