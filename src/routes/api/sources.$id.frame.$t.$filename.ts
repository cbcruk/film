import { createFileRoute } from '@tanstack/react-router'
import { Effect, Schema } from 'effect'
import { contentDisposition, extractFrame } from '../../server/frames.ts'
import { runRouteEffect } from '../../server/runtime.ts'
import {
  SecondsFromString,
  SourceId,
  decodeParams,
} from '../../server/schema.ts'

const Params = Schema.Struct({
  id: SourceId,
  t: SecondsFromString,
  filename: Schema.String,
})

// 원본 해상도 프레임. 미리보기 <img>의 src이자 [다른 이름으로 저장]의 대상.
// URL 마지막 경로가 저장 창의 기본 파일명이 된다
export const Route = createFileRoute('/api/sources/$id/frame/$t/$filename')({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        runRouteEffect(
          Effect.gen(function* () {
            const input = yield* decodeParams(Params)(params)
            const frame = yield* extractFrame(input)
            return new Response(new Uint8Array(frame.bytes), {
              headers: {
                'Content-Type': frame.contentType,
                'Content-Disposition': contentDisposition(frame.filename),
                // 같은 URL은 항상 같은 이미지 (ID에 파일 크기·수정 시각 포함)
                'Cache-Control': 'max-age=31536000, immutable',
              },
            })
          }),
          request,
        ),
    },
  },
})
