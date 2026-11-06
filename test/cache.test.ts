import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { NodeServices } from '@effect/platform-node'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer, Option } from 'effect'
import { Cache } from '../src/server/cache.ts'
import { testConfig } from './support/layers.ts'

const cacheLive = (cacheDir: string, cacheMaxBytes = 1024 ** 3) =>
  Cache.layer.pipe(
    Layer.provide(testConfig({ cacheDir, cacheMaxBytes })),
    Layer.provide(NodeServices.layer),
  )

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'film-cache-'))

/** 소스 디렉터리에 bytes 크기 파일을 만들고 meta.json 시각을 ageMinutes 전으로 */
const seed = (
  cacheDir: string,
  id: string,
  bytes: number,
  ageMinutes: number,
) => {
  const dir = path.join(cacheDir, id)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'thumb_1.000.jpg'), Buffer.alloc(bytes))
  fs.writeFileSync(path.join(dir, 'meta.json'), '{}')
  const time = new Date(Date.now() - ageMinutes * 60_000)
  fs.utimesSync(path.join(dir, 'meta.json'), time, time)
}

describe('Cache', () => {
  it.effect('meta.json을 쓰고 읽는다', () => {
    const dir = tmp()
    return Effect.gen(function* () {
      const cache = yield* Cache
      assert.isFalse(yield* cache.has('aaaaaaaaaaaaaaaa'))
      const value = {
        path: '/x/a.mp4',
        meta: { duration: 1, width: 2, height: 3, fps: 4, codec: 'h264' },
      }
      yield* cache.writeMeta('aaaaaaaaaaaaaaaa', value)
      assert.isTrue(yield* cache.has('aaaaaaaaaaaaaaaa'))
      assert.deepStrictEqual(
        yield* cache.readMeta('aaaaaaaaaaaaaaaa'),
        Option.some(value),
      )
      assert.strictEqual(
        cache.thumbPath('aaaaaaaaaaaaaaaa', 12.3456),
        path.join(dir, 'aaaaaaaaaaaaaaaa', 'thumb_12.346.jpg'),
      )
    }).pipe(Effect.provide(cacheLive(dir)))
  })

  it.effect('깨진 meta.json은 없는 것으로 본다', () => {
    const dir = tmp()
    fs.mkdirSync(path.join(dir, 'bbbbbbbbbbbbbbbb'))
    fs.writeFileSync(path.join(dir, 'bbbbbbbbbbbbbbbb', 'meta.json'), '{oops')
    return Effect.gen(function* () {
      const meta = yield* (yield* Cache).readMeta('bbbbbbbbbbbbbbbb')
      assert.isTrue(Option.isNone(meta))
    }).pipe(Effect.provide(cacheLive(dir)))
  })

  it.effect('한도를 넘으면 오래 안 연 소스부터 지운다', () => {
    const dir = tmp()
    seed(dir, 'old', 400, 30)
    seed(dir, 'mid', 400, 20)
    seed(dir, 'new', 400, 10)
    return Effect.gen(function* () {
      yield* (yield* Cache).cleanup
      assert.deepStrictEqual(fs.readdirSync(dir).sort(), ['mid', 'new'])
    }).pipe(Effect.provide(cacheLive(dir, 1000)))
  })
})
