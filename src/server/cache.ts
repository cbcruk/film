import '@tanstack/react-start/server-only'
import path from 'node:path'
import {
  Context,
  Effect,
  FileSystem,
  Layer,
  Option,
  Schedule,
  Schema,
} from 'effect'
import { timeKey } from '../lib/timecode.ts'
import { AppConfig } from './config.ts'

const CachedMeta = Schema.Struct({
  path: Schema.String,
  meta: Schema.Struct({
    duration: Schema.Number,
    width: Schema.Number,
    height: Schema.Number,
    fps: Schema.Number,
    codec: Schema.String,
  }),
})
export type CachedMeta = typeof CachedMeta.Type
const decodeMeta = Schema.decodeUnknownEffect(Schema.fromJsonString(CachedMeta))

const META = 'meta.json'

/**
 * ~/.cache/film/{sourceId}/ 관리.
 * 캐시 디렉터리 쓰기 실패는 예상하지 않는 상황이므로 결함(defect)으로 처리한다.
 */
export class Cache extends Context.Service<
  Cache,
  {
    readonly thumbPath: (id: string, t: number) => string
    /** 썸네일을 쓰기 전에 소스 디렉터리를 만든다 */
    readonly prepare: (id: string) => Effect.Effect<void>
    /** probe 결과가 저장되어 있는지 (= 한 번이라도 연 소스) */
    readonly has: (id: string) => Effect.Effect<boolean>
    readonly exists: (file: string) => Effect.Effect<boolean>
    /** 저장된 probe 결과. 읽으면서 접근 시각을 갱신한다 (용량 정리 순서) */
    readonly readMeta: (id: string) => Effect.Effect<Option.Option<CachedMeta>>
    readonly writeMeta: (id: string, value: CachedMeta) => Effect.Effect<void>
    /** 총 용량이 한도를 넘으면 오래 안 연 소스부터 지운다 */
    readonly cleanup: Effect.Effect<void>
  }
>()('film/server/Cache') {
  static readonly layer = Layer.effect(
    Cache,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const { cacheDir, cacheMaxBytes } = yield* AppConfig

      const dirOf = (id: string) => path.join(cacheDir, id)
      const metaOf = (id: string) => path.join(dirOf(id), META)

      const thumbPath = (id: string, t: number) =>
        path.join(dirOf(id), `thumb_${timeKey(t)}.jpg`)

      const prepare = (id: string) =>
        fs.makeDirectory(dirOf(id), { recursive: true }).pipe(Effect.orDie)

      const exists = (file: string) =>
        fs.exists(file).pipe(Effect.orElseSucceed(() => false))

      const has = (id: string) => exists(metaOf(id))

      const readMeta = (id: string) =>
        fs.readFileString(metaOf(id)).pipe(
          Effect.flatMap(decodeMeta),
          Effect.tap(() => {
            const now = new Date()
            return fs.utimes(metaOf(id), now, now)
          }),
          Effect.option,
        )

      const writeMeta = (id: string, value: CachedMeta) =>
        Effect.gen(function* () {
          yield* prepare(id)
          // 동시에 써도 겹치지 않도록 임시 파일 이름을 매번 다르게
          const tmp = `${metaOf(id)}.${process.pid}-${Math.random().toString(36).slice(2)}.tmp`
          yield* fs.writeFileString(tmp, JSON.stringify(value))
          yield* fs.rename(tmp, metaOf(id))
        }).pipe(Effect.orDie)

      const cleanup = Effect.gen(function* () {
        if (!(yield* exists(cacheDir))) return
        const ids = yield* fs.readDirectory(cacheDir)

        const entries = yield* Effect.forEach(
          ids,
          (id) =>
            Effect.gen(function* () {
              const dir = dirOf(id)
              const files = yield* fs.readDirectory(dir)
              const sizes = yield* Effect.forEach(files, (f) =>
                fs.stat(path.join(dir, f)).pipe(
                  Effect.map((s) => Number(s.size)),
                  Effect.orElseSucceed(() => 0),
                ),
              )
              // meta.json이 없으면 디렉터리 자체 시각으로 대신한다
              const info = yield* fs
                .stat(metaOf(id))
                .pipe(Effect.catch(() => fs.stat(dir)))
              const used = Option.getOrElse(info.mtime, () => new Date(0))
              return Option.some({
                dir,
                bytes: sizes.reduce((a, b) => a + b, 0),
                used: used.getTime(),
              })
            }).pipe(Effect.orElseSucceed(() => Option.none())),
          { concurrency: 8 },
        )

        const dirs = entries
          .flatMap(Option.toArray)
          .sort((a, b) => a.used - b.used)
        let total = dirs.reduce((sum, d) => sum + d.bytes, 0)
        for (const d of dirs) {
          if (total <= cacheMaxBytes) break
          yield* fs.remove(d.dir, { recursive: true })
          total -= d.bytes
        }
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning('캐시 정리 실패', cause),
        ),
        Effect.withSpan('Cache.cleanup'),
      )

      // 시작 시 한 번, 이후 1시간마다. 레이어(런타임)가 정리되면 함께 멈춘다
      yield* cleanup.pipe(
        Effect.repeat(Schedule.spaced('1 hour')),
        Effect.forkScoped,
      )

      return Cache.of({
        thumbPath,
        prepare,
        has,
        exists,
        readMeta,
        writeMeta,
        cleanup,
      })
    }),
  )
}
