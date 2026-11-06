import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { NodeServices } from '@effect/platform-node'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { Cache } from '../src/server/cache.ts'
import { Ffmpeg } from '../src/server/ffmpeg.ts'
import { contentDisposition, extractFrame } from '../src/server/frames.ts'
import { Library } from '../src/server/library.ts'
import { FIXTURES, testConfig } from './support/layers.ts'

const layer = Layer.mergeAll(Ffmpeg.layer, Library.layer, Cache.layer).pipe(
  Layer.provideMerge(
    testConfig({
      filmDir: FIXTURES,
      cacheDir: fs.mkdtempSync(path.join(os.tmpdir(), 'film-frames-')),
    }),
  ),
  Layer.provideMerge(NodeServices.layer),
)

const idOf = (name: string) =>
  Effect.gen(function* () {
    const videos = yield* (yield* Library).list
    return videos.find((v) => v.name === name)!.id
  })

const fail = (input: { id: string; t: number; filename: string }) =>
  extractFrame(input).pipe(Effect.flip)

describe('extractFrame', () => {
  it.live('원본 해상도 PNG와 Content-Type', () =>
    Effect.gen(function* () {
      const id = yield* idOf('h264.mp4')
      const frame = yield* extractFrame({
        id,
        t: 3.2,
        filename: 'h264_00m03s200.png',
      })
      assert.strictEqual(frame.contentType, 'image/png')
      // PNG IHDR: 16~23바이트가 가로·세로
      const view = Buffer.from(frame.bytes)
      assert.deepStrictEqual(
        [view.readUInt32BE(16), view.readUInt32BE(20)],
        [640, 360],
      )
    }).pipe(Effect.provide(layer)),
  )

  it.live('JPEG', () =>
    Effect.gen(function* () {
      const id = yield* idOf('vp9.webm')
      const frame = yield* extractFrame({ id, t: 1, filename: 'x.JPG' })
      assert.strictEqual(frame.contentType, 'image/jpeg')
      assert.strictEqual(frame.bytes[0], 0xff)
    }).pipe(Effect.provide(layer)),
  )

  it.live('잘못된 파일명·확장자·시점은 InvalidParam', () =>
    Effect.gen(function* () {
      const id = yield* idOf('h264.mp4')
      for (const filename of ['a.gif', 'a', 'dir/a.png', '..\\a.png', '.png']) {
        const error = yield* fail({ id, t: 1, filename })
        assert.strictEqual(error._tag, 'InvalidParam', filename)
      }
      const late = yield* fail({ id, t: 10, filename: 'a.png' })
      assert.strictEqual(late._tag, 'InvalidParam')
    }).pipe(Effect.provide(layer)),
  )

  it.live('이 ffmpeg에 없는 포맷은 InvalidParam', () =>
    Effect.gen(function* () {
      const formats = yield* (yield* Ffmpeg).formats
      if (formats.includes('webp')) return
      const id = yield* idOf('h264.mp4')
      const error = yield* fail({ id, t: 1, filename: 'a.webp' })
      assert.strictEqual(error._tag, 'InvalidParam')
    }).pipe(Effect.provide(layer)),
  )

  it.live('모르는 ID는 FileNotFound, 영상이 아니면 NotAVideo', () =>
    Effect.gen(function* () {
      const unknown = yield* fail({
        id: '0123456789abcdef',
        t: 1,
        filename: 'a.png',
      })
      assert.strictEqual(unknown._tag, 'FileNotFound')
      const id = yield* idOf('audio-only.mp4')
      const audio = yield* fail({ id, t: 1, filename: 'a.png' })
      assert.strictEqual(audio._tag, 'NotAVideo')
    }).pipe(Effect.provide(layer)),
  )
})

describe('contentDisposition', () => {
  it('ASCII 대체 이름과 UTF-8 이름을 함께 넣는다', () => {
    assert.strictEqual(
      contentDisposition('뮤비 "1".png'),
      `inline; filename="__ _1_.png"; filename*=UTF-8''%EB%AE%A4%EB%B9%84%20%221%22.png`,
    )
  })
})
