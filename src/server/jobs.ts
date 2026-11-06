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
import {
  type SceneCut,
  pickScenes,
  rangeTimes,
  thumbUrl,
  thumbnailTimes,
} from '../lib/timecode.ts'
import type {
  RetryResult,
  SourceEvent,
  SourceInfo,
  ThumbCount,
  ThumbMode,
  VideoMeta,
} from '../lib/types.ts'
import { Cache } from './cache.ts'
import { AppConfig } from './config.ts'
import {
  type ExtractFailed,
  type FfmpegTimeout,
  FileNotFound,
  InvalidParam,
  type NotAVideo,
  toErrorBody,
} from './errors.ts'
import { Ffmpeg } from './ffmpeg.ts'
import { Library } from './library.ts'

/** 지금 열린 소스와 그 썸네일 세트. 로컬 단일 사용자 도구라 한 번에 하나만 둔다 */
interface Job {
  readonly info: SourceInfo
  readonly file: string
  /** 요청한 방식·개수 (장면 모드는 실제 장수가 적거나 균등으로 대신될 수 있어 요청 기준으로 재사용) */
  readonly requested: { readonly mode: ThumbMode; readonly count: ThumbCount }
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
      /** 기본 'even'. 'scene'이면 장면 전환 시점에서 고른다 (F3-7) */
      readonly mode?: ThumbMode
    }) => Effect.Effect<
      SourceInfo,
      FileNotFound | NotAVideo | FfmpegTimeout | ExtractFailed
    >
    /** 소스의 이벤트 스트림. 이미 발행된 이벤트부터 보내고 `done`에서 끝난다.
     *  열린 소스가 아니면 FileNotFound (클라이언트는 open을 다시 호출) */
    readonly events: (
      id: string,
    ) => Effect.Effect<Stream.Stream<SourceEvent>, FileNotFound>
    /** 열린 소스의 from~to 구간을 count장으로 다시 나눈 새 세트 (F3-6). 진행 중인 세트는 취소된다 */
    readonly createSet: (input: {
      readonly id: string
      readonly count: ThumbCount
      readonly from: number
      readonly to: number
    }) => Effect.Effect<SourceInfo, FileNotFound | InvalidParam>
    /** 현재 세트의 썸네일 한 장을 다시 만든다. 결과는 기록에서 그 칸의 이벤트를 교체하고, 구독자에게도 보낸다 */
    readonly retry: (input: {
      readonly id: string
      readonly setId: string
      readonly index: number
    }) => Effect.Effect<RetryResult, FileNotFound | InvalidParam>
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
      // 장면 분석도 한 번에 하나씩 (dev StrictMode의 중복 호출은 두 번째가 캐시를 읽는다)
      const analyzing = yield* Semaphore.make(1)

      const publish = (job: Job, event: SourceEvent) =>
        job.lock.withPermit(
          Effect.gen(function* () {
            yield* Ref.update(job.history, (h) => [...h, event])
            yield* PubSub.publish(job.pubsub, event)
          }),
        )

      /** 같은 칸의 thumb/error 이벤트를 기록에서 교체한다 (재시도). `done` 뒤에 덧붙이면 재연결 시 잘린다 */
      const replace = (job: Job, event: RetryResult) =>
        job.lock.withPermit(
          Effect.gen(function* () {
            yield* Ref.update(job.history, (h) =>
              h.map((e) =>
                (e.type === 'thumb' || e.type === 'error') &&
                e.index === event.index
                  ? event
                  : e,
              ),
            )
            yield* PubSub.publish(job.pubsub, event)
          }),
        )

      /** 한 칸의 썸네일. 캐시에 있으면 그대로 쓴다 */
      const extract = (job: Job, index: number) =>
        Effect.gen(function* () {
          const { id, setId, times } = job.info
          const t = times[index]!
          const out = cache.thumbPath(id, t)
          const failure = (yield* cache.exists(out))
            ? Option.none()
            : yield* ffmpeg
                .thumbnail(job.file, t, out)
                .pipe(Effect.flip, Effect.option)
          return Option.match(failure, {
            onNone: (): RetryResult => ({
              type: 'thumb',
              setId,
              index,
              t,
              url: thumbUrl(id, t),
            }),
            onSome: (error): RetryResult => ({
              type: 'error',
              setId,
              index,
              ...toErrorBody(error),
            }),
          })
        })

      const generate = (job: Job) =>
        Effect.gen(function* () {
          const { id, setId, times } = job.info
          const finished = yield* Ref.make(0)
          yield* cache.prepare(id)

          yield* Effect.forEach(
            times,
            (_, index) =>
              Effect.gen(function* () {
                yield* publish(job, yield* extract(job, index))
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

      /** 장면 전환 후보. 캐시(scenes.json)에 없을 때만 분석한다 */
      const sceneCuts = (id: string, file: string) =>
        Effect.gen(function* () {
          const cached = yield* cache.readScenes(id)
          if (Option.isSome(cached)) return cached.value
          const cuts = yield* ffmpeg.scenes(file)
          yield* cache.writeScenes(id, cuts)
          return cuts
        }).pipe(analyzing.withPermit)

      type OpenInput = {
        readonly id: string
        readonly count: ThumbCount
        readonly mode?: ThumbMode
      }

      /** 같은 소스·개수·방식의 전체 세트가 이미 있으면 그것 */
      const reusable = (input: OpenInput) =>
        Ref.get(current).pipe(
          Effect.map((existing) =>
            Option.filter(
              existing,
              (job) =>
                job.info.id === input.id &&
                job.info.range === undefined &&
                job.requested.mode === (input.mode ?? 'even') &&
                job.requested.count === input.count,
            ),
          ),
        )

      const openUnsafe = Effect.fn('Jobs.open')(function* (
        input: OpenInput,
        cuts: ReadonlyArray<SceneCut> | undefined,
      ) {
        const existing = yield* reusable(input)
        if (Option.isSome(existing)) return existing.value.info

        const file = yield* library.resolve(input.id)
        const meta = yield* loadMeta(input.id, file)
        const scenes =
          cuts === undefined ? [] : pickScenes(cuts, input.count, meta.duration)
        // 장면 모드인데 전환을 하나도 못 찾으면 균등 분할로 대신한다
        const mode: ThumbMode = scenes.length > 0 ? 'scene' : 'even'
        return yield* start({
          id: input.id,
          file,
          meta,
          requested: { mode: input.mode ?? 'even', count: input.count },
          mode,
          times:
            mode === 'scene'
              ? scenes
              : thumbnailTimes(meta.duration, input.count),
          ...(cuts === undefined ? {} : { sceneCuts: cuts.length }),
        })
      })

      const open = (input: OpenInput) =>
        Effect.gen(function* () {
          // 장면 분석은 오래 걸릴 수 있어 open 잠금 밖에서 한다 (그동안 다른 소스도 열 수 있게)
          let cuts: ReadonlyArray<SceneCut> | undefined
          if (input.mode === 'scene' && Option.isNone(yield* reusable(input))) {
            const file = yield* library.resolve(input.id)
            cuts = yield* sceneCuts(input.id, file)
          }
          return yield* opening.withPermit(openUnsafe(input, cuts))
        })

      /** 새 세트를 등록하고 생성을 시작한다. 이전 작업은 FiberHandle이 인터럽트한다 */
      const start = Effect.fn('Jobs.start')(function* (input: {
        readonly id: string
        readonly file: string
        readonly meta: VideoMeta
        readonly times: ReadonlyArray<number>
        readonly requested: Job['requested']
        readonly mode: ThumbMode
        readonly sceneCuts?: number
        readonly range?: { readonly from: number; readonly to: number }
      }) {
        const setId = `s${yield* Ref.getAndUpdate(nextSet, (n) => n + 1)}`
        const job: Job = {
          info: {
            ...input.meta,
            id: input.id,
            name: path.basename(input.file),
            setId,
            times: input.times,
            mode: input.mode,
            ...(input.sceneCuts === undefined
              ? {}
              : { sceneCuts: input.sceneCuts }),
            ...(input.range ? { range: input.range } : {}),
          },
          file: input.file,
          requested: input.requested,
          history: yield* Ref.make<ReadonlyArray<SourceEvent>>([]),
          pubsub: yield* PubSub.unbounded<SourceEvent>(),
          lock: yield* Semaphore.make(1),
        }
        // 구독자가 바로 찾을 수 있도록 작업을 먼저 등록한 뒤 시작한다
        yield* Ref.set(current, Option.some(job))
        yield* FiberHandle.run(running, generate(job))
        return job.info
      })

      const notOpen = new FileNotFound({
        message: '열린 소스가 아닙니다. 다시 여세요',
      })

      /** 지금 열린 소스의 작업 (다른 소스면 FileNotFound) */
      const currentFor = (id: string) =>
        Ref.get(current).pipe(
          Effect.flatMap((job) =>
            Option.isSome(job) && job.value.info.id === id
              ? Effect.succeed(job.value)
              : Effect.fail(notOpen),
          ),
        )

      const createSetUnsafe = Effect.fn('Jobs.createSet')(function* (input: {
        readonly id: string
        readonly count: ThumbCount
        readonly from: number
        readonly to: number
      }) {
        const job = yield* currentFor(input.id)
        const { duration } = job.info
        const { from, to, count } = input
        // 밀리초 단위로 나누므로 한 장당 최소 1ms는 있어야 시점이 겹치지 않는다
        if (!(
          from >= 0 &&
          to <= duration &&
          to - from >= (count + 1) * 0.001
        )) {
          return yield* new InvalidParam({
            message: `구간이 올바르지 않습니다: ${from}~${to} (영상 길이 ${duration}초)`,
          })
        }
        const { id, width, height, fps, codec } = job.info
        const meta: VideoMeta = { duration, width, height, fps, codec }
        return yield* start({
          id,
          file: job.file,
          meta,
          times: rangeTimes(from, to, count),
          requested: { mode: job.requested.mode, count },
          mode: job.info.mode,
          range: { from, to },
        })
      })

      const createSet = (input: Parameters<typeof createSetUnsafe>[0]) =>
        opening.withPermit(createSetUnsafe(input))

      const retry = Effect.fn('Jobs.retry')(function* (input: {
        readonly id: string
        readonly setId: string
        readonly index: number
      }) {
        const job = yield* currentFor(input.id)
        if (job.info.setId !== input.setId) {
          return yield* new InvalidParam({
            message: '지난 세트입니다. 화면을 새로고침하세요',
          })
        }
        if (
          !Number.isInteger(input.index) ||
          input.index < 0 ||
          input.index >= job.info.times.length
        ) {
          return yield* new InvalidParam({
            message: '썸네일 번호가 올바르지 않습니다',
          })
        }
        const result = yield* extract(job, input.index)
        yield* replace(job, result)
        return result
      })

      const events = (id: string) => Effect.map(currentFor(id), subscribe)

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

      return Jobs.of({ open, events, createSet, retry })
    }),
  )
}
