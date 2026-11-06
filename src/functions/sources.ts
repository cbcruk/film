import { createServerFn } from '@tanstack/react-start'
import { Effect, Schema } from 'effect'
import type { VideoList } from '../lib/types.ts'
import { Cache } from '../server/cache.ts'
import { AppConfig } from '../server/config.ts'
import { Jobs } from '../server/jobs.ts'
import { Library } from '../server/library.ts'
import { runServerEffect } from '../server/runtime.ts'
import { OpenSourceInput } from '../server/schema.ts'

/** FILM_DIR의 영상 목록 (수정 시각 최신순) */
export const listVideos = createServerFn({ method: 'GET' }).handler(() =>
  runServerEffect(
    Effect.gen(function* () {
      const { filmDir } = yield* AppConfig
      const cache = yield* Cache
      const videos = yield* (yield* Library).list
      const withCache = yield* Effect.forEach(
        videos,
        (v) => Effect.map(cache.has(v.id), (cached) => ({ ...v, cached })),
        { concurrency: 16 },
      )
      const result: VideoList = { dir: filmDir, videos: withCache }
      return result
    }),
  ),
)

/** 소스를 열고 썸네일 세트 생성을 시작한다. 진행 상황은 SSE(/api/sources/$id/events)로 */
export const openSource = createServerFn({ method: 'POST' })
  .validator(Schema.toStandardSchemaV1(OpenSourceInput))
  .handler(({ data }) =>
    runServerEffect(Effect.flatMap(Jobs, (jobs) => jobs.open(data))),
  )
