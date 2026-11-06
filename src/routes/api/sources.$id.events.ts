import { createFileRoute } from '@tanstack/react-router'
import { Effect, Schema, Stream } from 'effect'
import { Jobs } from '../../server/jobs.ts'
import { runRouteEffect } from '../../server/runtime.ts'
import { SourceId, decodeParams } from '../../server/schema.ts'

const Params = Schema.Struct({ id: SourceId })

// SSE: 썸네일이 만들어지는 대로 보낸다. 이미 만들어진 것부터 보내고 `done` 뒤에 연결을 닫는다
// (EventSource는 닫히면 자동 재연결하므로 클라이언트는 `done`을 받으면 직접 close한다)
export const Route = createFileRoute('/api/sources/$id/events')({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        runRouteEffect(
          Effect.gen(function* () {
            const { id } = yield* decodeParams(Params)(params)
            const events = yield* (yield* Jobs).events(id)
            const body = yield* events.pipe(
              Stream.map(
                (e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`,
              ),
              Stream.encodeText,
              Stream.toReadableStreamEffect(),
            )
            return new Response(body, {
              headers: {
                'Content-Type': 'text/event-stream; charset=utf-8',
                'Cache-Control': 'no-cache',
              },
            })
          }),
          request,
        ),
    },
  },
})
