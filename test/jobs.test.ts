import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { NodeServices } from '@effect/platform-node'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Fiber, Layer, Stream } from 'effect'
import type { SourceEvent } from '../src/lib/types.ts'
import { Cache } from '../src/server/cache.ts'
import { Jobs } from '../src/server/jobs.ts'
import { Library } from '../src/server/library.ts'
import { type FakeOptions, ffmpegFake } from './fakes/ffmpeg.ts'
import { testConfig } from './support/layers.ts'

const makeDirs = () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'film-jobs-'))
  const filmDir = path.join(base, 'MV')
  fs.mkdirSync(filmDir)
  fs.writeFileSync(path.join(filmDir, 'a.mp4'), 'a')
  fs.writeFileSync(path.join(filmDir, 'b.mp4'), 'b')
  return { filmDir, cacheDir: path.join(base, 'cache') }
}

const setup = (dirs: ReturnType<typeof makeDirs>, options?: FakeOptions) => {
  const fake = ffmpegFake(options)
  const layer = Jobs.layer.pipe(
    Layer.provideMerge(Layer.mergeAll(fake.layer, Library.layer, Cache.layer)),
    Layer.provideMerge(testConfig({ ...dirs, concurrency: 2 })),
    Layer.provideMerge(NodeServices.layer),
  )
  return { layer, stats: fake.stats }
}

const ids = Effect.gen(function* () {
  const videos = yield* (yield* Library).list
  const id = (name: string) => videos.find((v) => v.name === name)!.id
  return { a: id('a.mp4'), b: id('b.mp4') }
})

const collectEvents = (id: string) =>
  Effect.gen(function* () {
    const stream = yield* (yield* Jobs).events(id)
    return Array.from(yield* Stream.runCollect(stream))
  })

const ofType = <T extends SourceEvent['type']>(
  events: SourceEvent[],
  type: T,
) =>
  events.filter((e): e is Extract<SourceEvent, { type: T }> => e.type === type)

describe('Jobs', () => {
  it.live('세트를 만들고 동시성 한도를 지킨다', () => {
    const { layer, stats } = setup(makeDirs())
    return Effect.gen(function* () {
      const { a } = yield* ids
      const info = yield* (yield* Jobs).open({ id: a, count: 12 })
      assert.strictEqual(info.times.length, 12)
      assert.strictEqual(info.times[0], 2)
      assert.strictEqual(info.times[11], 98)
      assert.strictEqual(info.name, 'a.mp4')

      const events = yield* collectEvents(a)
      const thumbs = ofType(events, 'thumb')
      assert.strictEqual(thumbs.length, 12)
      assert.deepStrictEqual(
        thumbs.map((e) => e.index).sort((x, y) => x - y),
        [...Array(12).keys()],
      )
      assert.strictEqual(
        thumbs[0]!.url,
        `/api/sources/${a}/thumb?t=${thumbs[0]!.t.toFixed(3)}`,
      )
      assert.deepStrictEqual(ofType(events, 'progress').at(-1), {
        type: 'progress',
        setId: info.setId,
        done: 12,
        total: 12,
      })
      assert.deepStrictEqual(events.at(-1), { type: 'done', setId: info.setId })
      assert.strictEqual(stats.maxActive, 2)
    }).pipe(Effect.provide(layer))
  })

  it.live('늦게 구독해도 이미 발행된 이벤트를 모두 받는다', () => {
    const { layer } = setup(makeDirs())
    return Effect.gen(function* () {
      const { a } = yield* ids
      const jobs = yield* Jobs
      yield* jobs.open({ id: a, count: 6 })
      const early = yield* collectEvents(a) // 끝날 때까지
      const late = yield* collectEvents(a) // 끝난 뒤 구독
      assert.deepStrictEqual(late, early)
      assert.strictEqual(late.length, 6 + 6 + 1)
    }).pipe(Effect.provide(layer))
  })

  it.live('진행 중에 구독해도 누락·중복 없이 받는다', () => {
    const { layer } = setup(makeDirs(), { delay: '30 millis' })
    return Effect.gen(function* () {
      const { a } = yield* ids
      yield* (yield* Jobs).open({ id: a, count: 12 })
      yield* Effect.sleep('50 millis')
      const events = yield* collectEvents(a)
      assert.strictEqual(ofType(events, 'thumb').length, 12)
      assert.deepStrictEqual(
        ofType(events, 'progress').map((e) => e.done),
        [...Array(12).keys()].map((i) => i + 1),
      )
    }).pipe(Effect.provide(layer))
  })

  it.live('진행 중인 구독자는 모두 done까지 받는다 (작업 종료와 경쟁)', () => {
    const { layer } = setup(makeDirs(), { delay: '1 millis' })
    return Effect.gen(function* () {
      const { a } = yield* ids
      const jobs = yield* Jobs
      for (let round = 0; round < 5; round++) {
        yield* jobs.open({ id: a, count: round % 2 === 0 ? 24 : 48 })
        // 느리게 읽는 구독자 (브라우저 연결처럼 소비가 발행보다 늦는 경우)
        const slow = Effect.gen(function* () {
          const stream = yield* jobs.events(a)
          return Array.from(
            yield* Stream.runCollect(
              stream.pipe(Stream.tap(() => Effect.sleep('2 millis'))),
            ),
          )
        })
        const all = yield* Effect.all(
          Array.from({ length: 20 }, (_, i) =>
            Effect.sleep(`${i} millis`).pipe(Effect.andThen(slow)),
          ),
          { concurrency: 'unbounded' },
        )
        for (const events of all)
          assert.strictEqual(events.at(-1)?.type, 'done')
      }
    }).pipe(Effect.provide(layer))
  })

  it.live('새 소스를 열면 이전 작업은 인터럽트된다', () => {
    const { layer, stats } = setup(makeDirs(), { hang: true })
    return Effect.gen(function* () {
      const { a, b } = yield* ids
      const jobs = yield* Jobs
      yield* jobs.open({ id: a, count: 12 })
      const oldEvents = yield* collectEvents(a).pipe(Effect.forkChild)
      yield* Effect.sleep('30 millis')
      assert.strictEqual(stats.active, 2)

      yield* jobs.open({ id: b, count: 6 })
      yield* Effect.sleep('30 millis')
      assert.strictEqual(stats.interrupted, 2)
      assert.strictEqual(stats.active, 2) // b의 작업만 실행 중

      // 이전 소스의 구독 스트림은 끝나고, 이전 ID로는 더 구독할 수 없다
      const old = yield* Fiber.join(oldEvents)
      assert.isFalse(old.some((e) => e.type === 'done'))
      const error = yield* jobs.events(a).pipe(Effect.flip)
      assert.strictEqual(error._tag, 'FileNotFound')
    }).pipe(Effect.provide(layer))
  })

  it.live('같은 소스·개수로 다시 열면 진행 중인 세트를 그대로 쓴다', () => {
    const { layer, stats } = setup(makeDirs())
    return Effect.gen(function* () {
      const { a } = yield* ids
      const jobs = yield* Jobs
      const first = yield* jobs.open({ id: a, count: 6 })
      const again = yield* jobs.open({ id: a, count: 6 })
      assert.strictEqual(again.setId, first.setId)
      yield* collectEvents(a)
      assert.strictEqual(stats.calls, 6)

      const more = yield* jobs.open({ id: a, count: 12 })
      assert.notStrictEqual(more.setId, first.setId)
    }).pipe(Effect.provide(layer))
  })

  it.live('캐시에 있는 썸네일은 다시 만들지 않는다 (서버 재시작 후)', () => {
    const dirs = makeDirs()
    const first = setup(dirs)
    const second = setup(dirs)
    return Effect.gen(function* () {
      const run = Effect.gen(function* () {
        const { a } = yield* ids
        yield* (yield* Jobs).open({ id: a, count: 12 })
        return yield* collectEvents(a)
      })
      yield* run.pipe(Effect.provide(first.layer))
      const events = yield* run.pipe(Effect.provide(second.layer))
      assert.strictEqual(first.stats.calls, 12)
      assert.strictEqual(second.stats.calls, 0)
      assert.strictEqual(ofType(events, 'thumb').length, 12)
    })
  })

  it.live('실패한 시점은 error 이벤트로 알리고 나머지는 계속한다', () => {
    // 100초 영상, 12장 → 네 번째 시점은 2 + 96 * 3/11 = 28.182
    const { layer } = setup(makeDirs(), { failWhen: (t) => t === 28.182 })
    return Effect.gen(function* () {
      const { a } = yield* ids
      yield* (yield* Jobs).open({ id: a, count: 12 })
      const events = yield* collectEvents(a)
      const errors = ofType(events, 'error')
      assert.strictEqual(errors.length, 1)
      assert.include(errors[0]!, { index: 3, code: 'EXTRACT_FAILED' })
      assert.strictEqual(ofType(events, 'thumb').length, 11)
      assert.strictEqual(events.at(-1)?.type, 'done')
    }).pipe(Effect.provide(layer))
  })

  it.live('같은 소스를 동시에 열어도 작업은 하나다', () => {
    const { layer, stats } = setup(makeDirs())
    return Effect.gen(function* () {
      const { a } = yield* ids
      const jobs = yield* Jobs
      const [x, y] = yield* Effect.all(
        [jobs.open({ id: a, count: 6 }), jobs.open({ id: a, count: 6 })],
        { concurrency: 'unbounded' },
      )
      assert.strictEqual(x.setId, y.setId)
      yield* collectEvents(a)
      assert.strictEqual(stats.calls, 6)
    }).pipe(Effect.provide(layer))
  })

  it.live('구간 재생성: 새 세트를 만들고, 전체로 돌아가면 캐시를 쓴다', () => {
    const { layer, stats } = setup(makeDirs())
    return Effect.gen(function* () {
      const { a } = yield* ids
      const jobs = yield* Jobs
      const full = yield* jobs.open({ id: a, count: 6 })
      yield* collectEvents(a)

      const range = yield* jobs.createSet({ id: a, count: 6, from: 10, to: 17 })
      assert.notStrictEqual(range.setId, full.setId)
      assert.deepStrictEqual(range.range, { from: 10, to: 17 })
      assert.deepStrictEqual(range.times, [11, 12, 13, 14, 15, 16])
      const events = yield* collectEvents(a)
      assert.strictEqual(ofType(events, 'thumb').length, 6)
      assert.isTrue(events.every((e) => e.setId === range.setId))

      // 전체 세트로 돌아가기: 같은 개수라도 구간 세트를 재사용하지 않는다
      const back = yield* jobs.open({ id: a, count: 6 })
      assert.isUndefined(back.range)
      assert.deepStrictEqual(back.times, full.times)
      const calls = stats.calls
      yield* collectEvents(a)
      assert.strictEqual(stats.calls, calls) // 모두 캐시
    }).pipe(Effect.provide(layer))
  })

  it.live(
    '구간 재생성: 잘못된 구간은 InvalidParam, 열리지 않은 소스는 FileNotFound',
    () => {
      const { layer } = setup(makeDirs())
      return Effect.gen(function* () {
        const { a, b } = yield* ids
        const jobs = yield* Jobs
        yield* jobs.open({ id: a, count: 6 })
        for (const [from, to] of [
          [20, 10],
          [10, 10],
          [-1, 10],
          [90, 101],
          [10, 10.005],
        ] as const) {
          const error = yield* jobs
            .createSet({ id: a, count: 6, from, to })
            .pipe(Effect.flip)
          assert.strictEqual(error._tag, 'InvalidParam', `${from}~${to}`)
        }
        const other = yield* jobs
          .createSet({ id: b, count: 6, from: 1, to: 2 })
          .pipe(Effect.flip)
        assert.strictEqual(other._tag, 'FileNotFound')
      }).pipe(Effect.provide(layer))
    },
  )

  it.live(
    '재시도: 실패한 칸을 다시 만들고, 늦은 구독자도 바뀐 결과를 받는다',
    () => {
      let broken = true
      const { layer } = setup(makeDirs(), {
        failWhen: (t) => broken && t === 21.2,
      })
      return Effect.gen(function* () {
        const { a } = yield* ids
        const jobs = yield* Jobs
        const info = yield* jobs.open({ id: a, count: 6 })
        const first = yield* collectEvents(a)
        assert.include(ofType(first, 'error')[0]!, { index: 1 })

        broken = false
        const result = yield* jobs.retry({ id: a, setId: info.setId, index: 1 })
        assert.include(result, { type: 'thumb', index: 1, t: 21.2 })

        const replay = yield* collectEvents(a)
        assert.strictEqual(ofType(replay, 'error').length, 0)
        assert.strictEqual(ofType(replay, 'thumb').length, 6)
        assert.strictEqual(replay.at(-1)?.type, 'done')
      }).pipe(Effect.provide(layer))
    },
  )

  it.live('재시도: 지난 세트·잘못된 번호는 InvalidParam', () => {
    const { layer } = setup(makeDirs())
    return Effect.gen(function* () {
      const { a } = yield* ids
      const jobs = yield* Jobs
      const info = yield* jobs.open({ id: a, count: 6 })
      const stale = yield* jobs
        .retry({ id: a, setId: 's999', index: 0 })
        .pipe(Effect.flip)
      assert.strictEqual(stale._tag, 'InvalidParam')
      for (const index of [-1, 6, 1.5]) {
        const error = yield* jobs
          .retry({ id: a, setId: info.setId, index })
          .pipe(Effect.flip)
        assert.strictEqual(error._tag, 'InvalidParam', String(index))
      }
    }).pipe(Effect.provide(layer))
  })

  it.live('장면 모드: 전환 시점에서 고르고, 분석 결과는 캐시한다', () => {
    const dirs = makeDirs()
    const scenes = [
      { t: 12.5, score: 0.9 },
      { t: 40, score: 0.6 },
      { t: 77.25, score: 0.4 },
    ]
    const first = setup(dirs, { scenes })
    const second = setup(dirs, { scenes })
    return Effect.gen(function* () {
      const run = Effect.gen(function* () {
        const { a } = yield* ids
        const jobs = yield* Jobs
        const info = yield* jobs.open({ id: a, count: 6, mode: 'scene' })
        yield* collectEvents(a)
        const again = yield* jobs.open({ id: a, count: 6, mode: 'scene' })
        assert.strictEqual(again.setId, info.setId)
        const even = yield* jobs.open({ id: a, count: 6 })
        assert.notStrictEqual(even.setId, info.setId)
        assert.strictEqual(even.mode, 'even')
        return info
      })
      const info = yield* run.pipe(Effect.provide(first.layer))
      assert.strictEqual(info.mode, 'scene')
      assert.strictEqual(info.sceneCuts, 3)
      assert.deepStrictEqual(info.times, [12.5, 40, 77.25])
      assert.strictEqual(first.stats.sceneCalls, 1)

      yield* run.pipe(Effect.provide(second.layer))
      assert.strictEqual(second.stats.sceneCalls, 0) // scenes.json
    })
  })

  it.live('장면 모드: 전환이 없으면 균등 분할로 대신한다', () => {
    const { layer } = setup(makeDirs(), { scenes: [] })
    return Effect.gen(function* () {
      const { a } = yield* ids
      const jobs = yield* Jobs
      const info = yield* jobs.open({ id: a, count: 6, mode: 'scene' })
      assert.strictEqual(info.mode, 'even')
      assert.strictEqual(info.sceneCuts, 0)
      assert.strictEqual(info.times.length, 6)
      // 같은 요청이면 대신한 세트를 그대로 쓴다
      const again = yield* jobs.open({ id: a, count: 6, mode: 'scene' })
      assert.strictEqual(again.setId, info.setId)
    }).pipe(Effect.provide(layer))
  })

  it.live('장면 모드: 동시에 열어도 분석은 한 번', () => {
    const { layer, stats } = setup(makeDirs(), {
      scenes: [{ t: 50, score: 1 }],
    })
    return Effect.gen(function* () {
      const { a } = yield* ids
      const jobs = yield* Jobs
      const [x, y] = yield* Effect.all(
        [
          jobs.open({ id: a, count: 6, mode: 'scene' }),
          jobs.open({ id: a, count: 6, mode: 'scene' }),
        ],
        { concurrency: 'unbounded' },
      )
      assert.strictEqual(x.setId, y.setId)
      assert.strictEqual(stats.sceneCalls, 1)
    }).pipe(Effect.provide(layer))
  })

  it.live('모르는 ID는 FileNotFound', () => {
    const { layer } = setup(makeDirs())
    return Effect.gen(function* () {
      const error = yield* (yield* Jobs)
        .open({ id: '0123456789abcdef', count: 6 })
        .pipe(Effect.flip)
      assert.strictEqual(error._tag, 'FileNotFound')
    }).pipe(Effect.provide(layer))
  })
})
