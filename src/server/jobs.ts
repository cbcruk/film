import '@tanstack/react-start/server-only'
import path from 'node:path'
import {
  Context,
  Effect,
  Exit,
  FiberHandle,
  Layer,
  Option,
  PubSub,
  Ref,
  Semaphore,
  Stream,
} from 'effect'
import { thumbUrl, thumbnailTimes } from '../lib/timecode.ts'
import type { SourceEvent, SourceInfo, ThumbCount } from '../lib/types.ts'
import { Cache } from './cache.ts'
import { AppConfig } from './config.ts'
import {
  type FfmpegTimeout,
  FileNotFound,
  type NotAVideo,
  toErrorBody,
} from './errors.ts'
import { Ffmpeg } from './ffmpeg.ts'
import { Library } from './library.ts'

/** 지금 열린 소스와 그 썸네일 세트. 로컬 단일 사용자 도구라 한 번에 하나만 둔다 */
interface Job {
  readonly info: SourceInfo
  readonly file: string
  /** 지금까지 발행한 이벤트 (늦게 구독한 쪽에 먼저 보낸다) */
  readonly history: Ref.Ref<ReadonlyArray<SourceEvent>>
  readonly pubsub: PubSub.PubSub<SourceEvent>
  /** 발행(기록+전달)과 구독(기록 읽기+구독 시작)을 서로 배타적으로 → 이벤트 누락·중복 없음 */
  readonly lock: Semaphore.Semaphore
}

export class Jobs extends Context.Service<
  Jobs,
  {
    /** 소스를 열고 썸네일 세트 생성을 시작한다. 이전 소스의 작업은 취소된다.
     *  같은 소스·같은 개수로 다시 열면(새로고침 등) 진행 중인 세트를 그대로 돌려준다 */
    readonly open: (input: {
      readonly id: string
      readonly count: ThumbCount
    }) => Effect.Effect<SourceInfo, FileNotFound | NotAVideo | FfmpegTimeout>
    /** 소스의 이벤트 스트림. 이미 발행된 이벤트부터 보내고 `done`에서 끝난다.
     *  열린 소스가 아니면 FileNotFound (클라이언트는 open을 다시 호출) */
    readonly events: (
      id: string,
    ) => Effect.Effect<Stream.Stream<SourceEvent>, FileNotFound>
  }
>()('film/server/Jobs') {
  static readonly layer = Layer.effect(
    Jobs,
    Effect.gen(function* () {
      const ffmpeg = yield* Ffmpeg
      const library = yield* Library
      const cache = yield* Cache
      const { concurrency } = yield* AppConfig

      const current = yield* Ref.make(Option.none<Job>())
      const nextSet = yield* Ref.make(1)
      // 새 작업을 넣으면 이전 작업 Fiber를 인터럽트한다 (→ ffmpeg kill)
      const running = yield* FiberHandle.make<void, never>()
      // open은 한 번에 하나씩 (같은 소스를 동시에 열어도 작업이 하나만 생기도록)
      const opening = yield* Semaphore.make(1)

      const publish = (job: Job, event: SourceEvent) =>
        job.lock.withPermit(
          Effect.gen(function* () {
            yield* Ref.update(job.history, (h) => [...h, event])
            yield* PubSub.publish(job.pubsub, event)
          }),
        )

      const generate = (job: Job) =>
        Effect.gen(function* () {
          const { id, setId, times } = job.info
          const finished = yield* Ref.make(0)
          yield* cache.prepare(id)

          yield* Effect.forEach(
            times,
            (t, index) =>
              Effect.gen(function* () {
                const out = cache.thumbPath(id, t)
                const result = (yield* cache.exists(out))
                  ? Option.none()
                  : yield* ffmpeg
                      .thumbnail(job.file, t, out)
                      .pipe(Effect.flip, Effect.option)
                yield* Option.match(result, {
                  onNone: () =>
                    publish(job, {
                      type: 'thumb',
                      setId,
                      index,
                      t,
                      url: thumbUrl(id, t),
                    }),
                  onSome: (error) =>
                    publish(job, {
                      type: 'error',
                      setId,
                      index,
                      ...toErrorBody(error),
                    }),
                })
                const done = yield* Ref.updateAndGet(finished, (n) => n + 1)
                yield* publish(job, {
                  type: 'progress',
                  setId,
                  done,
                  total: times.length,
                })
              }),
            { concurrency, discard: true },
          )
          yield* publish(job, { type: 'done', setId })
        }).pipe(
          // 취소·실패 시에만 PubSub을 닫아 구독 스트림을 끝낸다.
          // 정상 종료 때 닫으면 구독자가 아직 꺼내지 않은 `done`이 버려진다 (M4에서 발견)
          // — 그때는 구독자가 `done`을 받고 스스로 끝난다
          Effect.onExit((exit) =>
            Exit.isSuccess(exit)
              ? Effect.void
              : job.lock.withPermit(PubSub.shutdown(job.pubsub)),
          ),
          Effect.withSpan('Jobs.generate'),
        )

      const loadMeta = Effect.fn('Jobs.loadMeta')(function* (
        id: string,
        file: string,
      ) {
        const cached = yield* cache.readMeta(id)
        if (Option.isSome(cached)) return cached.value.meta
        const meta = yield* ffmpeg.probe(file)
        yield* cache.writeMeta(id, { path: file, meta })
        return meta
      })

      const openUnsafe = Effect.fn('Jobs.open')(function* (input: {
        readonly id: string
        readonly count: ThumbCount
      }) {
        const existing = yield* Ref.get(current)
        if (
          Option.isSome(existing) &&
          existing.value.info.id === input.id &&
          existing.value.info.times.length === input.count
        ) {
          return existing.value.info
        }

        const file = yield* library.resolve(input.id)
        const meta = yield* loadMeta(input.id, file)
        const setId = `s${yield* Ref.getAndUpdate(nextSet, (n) => n + 1)}`

        const job: Job = {
          info: {
            ...meta,
            id: input.id,
            name: path.basename(file),
            setId,
            times: thumbnailTimes(meta.duration, input.count),
          },
          file,
          history: yield* Ref.make<ReadonlyArray<SourceEvent>>([]),
          pubsub: yield* PubSub.unbounded<SourceEvent>(),
          lock: yield* Semaphore.make(1),
        }
        // 구독자가 바로 찾을 수 있도록 작업을 먼저 등록한 뒤 시작한다
        yield* Ref.set(current, Option.some(job))
        yield* FiberHandle.run(running, generate(job))
        return job.info
      })

      const open = (input: {
        readonly id: string
        readonly count: ThumbCount
      }) => opening.withPermit(openUnsafe(input))

      const events = (id: string) =>
        Ref.get(current).pipe(
          Effect.flatMap((job) =>
            Option.isSome(job) && job.value.info.id === id
              ? Effect.succeed(subscribe(job.value))
              : Effect.fail(
                  new FileNotFound({
                    message: '열린 소스가 아닙니다. 다시 여세요',
                  }),
                ),
          ),
        )

      const subscribe = (job: Job): Stream.Stream<SourceEvent> =>
        Stream.unwrap(
          job.lock.withPermit(
            Effect.gen(function* () {
              const past = yield* Ref.get(job.history)
              // 이미 끝났거나(done 기록 있음) 취소된 작업이면 기록만 보낸다
              if (
                past.some((e) => e.type === 'done') ||
                (yield* PubSub.isShutdown(job.pubsub))
              ) {
                return Stream.fromIterable(past)
              }
              const subscription = yield* PubSub.subscribe(job.pubsub)
              return Stream.concat(
                Stream.fromIterable(past),
                Stream.fromSubscription(subscription),
              )
            }),
          ),
        ).pipe(Stream.takeUntil((e) => e.type === 'done'))

      return Jobs.of({ open, events })
    }),
  )
}
