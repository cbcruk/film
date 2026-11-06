import { createFileRoute } from '@tanstack/react-router'
import { Effect, FileSystem, Schema } from 'effect'
import { Cache } from '../../server/cache.ts'
import { FileNotFound } from '../../server/errors.ts'
import { runRouteEffect } from '../../server/runtime.ts'
import {
  SecondsFromString,
  SourceId,
  decodeParams,
} from '../../server/schema.ts'

const Params = Schema.Struct({ id: SourceId, t: SecondsFromString })

// 썸네일 JPEG. 캐시에 있는 것만 보낸다 (생성은 Jobs가 한다)
export const Route = createFileRoute('/api/sources/$id/thumb')({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        runRouteEffect(
          Effect.gen(function* () {
            const t = new URL(request.url).searchParams.get('t')
            const input = yield* decodeParams(Params)({ id: params.id, t })
            const file = (yield* Cache).thumbPath(input.id, input.t)
            const bytes = yield* (yield* FileSystem.FileSystem)
              .readFile(file)
              .pipe(
                Effect.mapError(
                  () => new FileNotFound({ message: '썸네일이 없습니다' }),
                ),
              )
            return new Response(new Uint8Array(bytes), {
              headers: {
                'Content-Type': 'image/jpeg',
                'Cache-Control': 'max-age=31536000, immutable',
              },
            })
          }),
          request,
        ),
    },
  },
})
