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
