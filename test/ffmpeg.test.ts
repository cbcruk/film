import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Stream } from 'effect'
import { Ffmpeg, parseScenes } from '../src/server/ffmpeg.ts'
import { ffmpegLive, fixture } from './support/layers.ts'

/** 해당 파일을 인자로 받은 ffmpeg/ffprobe가 아직 떠 있는지 */
const runningFor = (file: string) => {
  try {
    return execFileSync('pgrep', ['-f', file]).toString().trim() !== ''
  } catch {
    return false // pgrep은 결과가 없으면 exit 1
  }
}

const imageSize = (file: string) => {
  const out = execFileSync('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'stream=width,height',
    '-of',
    'csv=p=0',
    file,
  ])
    .toString()
    .trim()
  const [width, height] = out.split(',').map(Number)
  return { width, height }
}

const collect = (stream: Stream.Stream<Uint8Array, unknown>) =>
  Stream.runCollect(stream).pipe(
    Effect.map((chunks) => Buffer.concat(Array.from(chunks))),
  )

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'film-ffmpeg-'))

describe('Ffmpeg.checkInstalled', () => {
  it.live('ffmpeg 버전 문자열을 돌려준다', () =>
    Effect.gen(function* () {
      const version = yield* (yield* Ffmpeg).checkInstalled
      assert.match(version, /^ffmpeg version /)
    }).pipe(Effect.provide(ffmpegLive())),
  )
})

describe('Ffmpeg.formats', () => {
  it.live('png·jpg는 항상 지원, webp는 빌드에 따라 다르다', () =>
    Effect.gen(function* () {
      const formats = yield* (yield* Ffmpeg).formats
      assert.includeMembers([...formats], ['png', 'jpg'])
      const hasWebp = execFileSync('ffmpeg', ['-hide_banner', '-encoders'])
        .toString()
        .includes(' libwebp ')
      assert.strictEqual(formats.includes('webp'), hasWebp)
    }).pipe(Effect.provide(ffmpegLive())),
  )
})

describe('Ffmpeg.probe', () => {
  it.live('H.264 mp4', () =>
    Effect.gen(function* () {
      const meta = yield* (yield* Ffmpeg).probe(fixture('h264.mp4'))
      assert.closeTo(meta.duration, 10, 0.1)
      assert.deepStrictEqual(
        {
          width: meta.width,
          height: meta.height,
          fps: meta.fps,
          codec: meta.codec,
        },
        { width: 640, height: 360, fps: 30, codec: 'h264' },
      )
    }).pipe(Effect.provide(ffmpegLive())),
  )

  it.live('VP9 webm', () =>
    Effect.gen(function* () {
      const meta = yield* (yield* Ffmpeg).probe(fixture('vp9.webm'))
      assert.closeTo(meta.duration, 4, 0.1)
      assert.strictEqual(meta.codec, 'vp9')
      assert.strictEqual(meta.fps, 24)
    }).pipe(Effect.provide(ffmpegLive())),
  )

  it.live(
    '회전 메타데이터가 있으면 가로·세로를 바꿔 표시 크기를 돌려준다',
    () =>
      Effect.gen(function* () {
        const meta = yield* (yield* Ffmpeg).probe(fixture('rotated.mp4'))
        assert.deepStrictEqual([meta.width, meta.height], [360, 640])
      }).pipe(Effect.provide(ffmpegLive())),
  )

  for (const name of ['audio-only.mp4', 'not-a-video.mp4', 'missing.mp4']) {
    it.live(`${name} → NotAVideo`, () =>
      Effect.gen(function* () {
        const error = yield* (yield* Ffmpeg)
          .probe(fixture(name))
          .pipe(Effect.flip)
        assert.strictEqual(error._tag, 'NotAVideo')
      }).pipe(Effect.provide(ffmpegLive())),
    )
  }

  it.live('타임아웃이면 FfmpegTimeout, 프로세스는 남지 않는다', () =>
    Effect.gen(function* () {
      // 여러 번 열어도 ffprobe가 1ms 안에 끝날 수는 없다
      const error = yield* (yield* Ffmpeg)
        .probe(fixture('h264.mp4'))
        .pipe(Effect.flip)
      assert.strictEqual(error._tag, 'FfmpegTimeout')
      yield* Effect.sleep('200 millis')
      assert.isFalse(runningFor(fixture('h264.mp4')))
    }).pipe(Effect.provide(ffmpegLive({ ffmpegTimeout: Duration.millis(1) }))),
  )
})

describe('Ffmpeg.scenes', () => {
  it('metadata=print 출력을 읽는다', () => {
    assert.deepStrictEqual(
      parseScenes(
        'frame:0    pts:3917    pts_time:3.917\nlavfi.scene_score=0.238298\n' +
          'frame:1    pts:7000    pts_time:7\nlavfi.scene_score=0.414858\n',
      ),
      [
        { t: 3.917, score: 0.238298 },
        { t: 7, score: 0.414858 },
      ],
    )
    assert.deepStrictEqual(parseScenes(''), [])
  })

  it.live('2·4·6초의 장면 전환을 찾는다', () =>
    Effect.gen(function* () {
      const cuts = yield* (yield* Ffmpeg).scenes(fixture('scenes.mp4'))
      const strong = cuts.filter((c) => c.score > 0.3).map((c) => c.t)
      assert.strictEqual(strong.length, 3)
      for (const [i, expected] of [2, 4, 6].entries()) {
        assert.closeTo(strong[i]!, expected, 0.05)
      }
    }).pipe(Effect.provide(ffmpegLive())),
  )

  it.live('영상이 아니면 ExtractFailed', () =>
    Effect.gen(function* () {
      const error = yield* (yield* Ffmpeg)
        .scenes(fixture('not-a-video.mp4'))
        .pipe(Effect.flip)
      assert.strictEqual(error._tag, 'ExtractFailed')
    }).pipe(Effect.provide(ffmpegLive())),
  )
})

describe('Ffmpeg.thumbnail', () => {
  it.live('가로 320 JPEG를 쓰고 임시 파일을 남기지 않는다', () =>
    Effect.gen(function* () {
      const dir = tmpDir()
      const out = path.join(dir, 'thumb_2.500.jpg')
      yield* (yield* Ffmpeg).thumbnail(fixture('h264.mp4'), 2.5, out)
      assert.deepStrictEqual(imageSize(out), { width: 320, height: 180 })
      assert.deepStrictEqual(fs.readdirSync(dir), ['thumb_2.500.jpg'])
    }).pipe(Effect.provide(ffmpegLive())),
  )

  it.live('영상 길이를 넘는 시점은 ExtractFailed, 파일을 남기지 않는다', () =>
    Effect.gen(function* () {
      const dir = tmpDir()
      const error = yield* (yield* Ffmpeg)
        .thumbnail(fixture('h264.mp4'), 60, path.join(dir, 'thumb.jpg'))
        .pipe(Effect.flip)
      assert.strictEqual(error._tag, 'ExtractFailed')
      assert.deepStrictEqual(fs.readdirSync(dir), [])
    }).pipe(Effect.provide(ffmpegLive())),
  )
})

describe('Ffmpeg.frame', () => {
  const magic = {
    png: (b: Buffer) => b.subarray(1, 4).toString() === 'PNG',
    jpg: (b: Buffer) => b[0] === 0xff && b[1] === 0xd8,
    webp: (b: Buffer) => b.subarray(8, 12).toString() === 'WEBP',
  }

  for (const format of ['png', 'jpg', 'webp'] as const) {
    it.live(`${format}: 원본 해상도로 출력한다`, (ctx) =>
      Effect.gen(function* () {
        const ffmpeg = yield* Ffmpeg
        if (!(yield* ffmpeg.formats).includes(format)) {
          return ctx.skip(`이 ffmpeg 빌드에는 ${format} 인코더가 없습니다`)
        }
        const bytes = yield* collect(
          ffmpeg.frame(fixture('h264.mp4'), 3.2, format),
        )
        assert.isTrue(magic[format](bytes))
        const file = path.join(tmpDir(), `frame.${format}`)
        fs.writeFileSync(file, bytes)
        assert.deepStrictEqual(imageSize(file), { width: 640, height: 360 })
      }).pipe(Effect.provide(ffmpegLive())),
    )
  }

  it.live('회전 영상은 회전을 적용한 크기로 출력한다', () =>
    Effect.gen(function* () {
      const bytes = yield* collect(
        (yield* Ffmpeg).frame(fixture('rotated.mp4'), 1, 'png'),
      )
      const file = path.join(tmpDir(), 'frame.png')
      fs.writeFileSync(file, bytes)
      assert.deepStrictEqual(imageSize(file), { width: 360, height: 640 })
    }).pipe(Effect.provide(ffmpegLive())),
  )

  it.live('영상 길이를 넘는 시점은 ExtractFailed', () =>
    Effect.gen(function* () {
      const error = yield* collect(
        (yield* Ffmpeg).frame(fixture('h264.mp4'), 60, 'png'),
      ).pipe(Effect.flip)
      assert.strictEqual((error as { _tag: string })._tag, 'ExtractFailed')
    }).pipe(Effect.provide(ffmpegLive())),
  )

  it.live('스트림을 중간에 끊으면 프로세스가 종료된다', () =>
    Effect.gen(function* () {
      const file = fixture('vp9.webm')
      yield* (yield* Ffmpeg)
        .frame(file, 1, 'png')
        .pipe(Stream.take(1), Stream.runDrain)
      yield* Effect.sleep('200 millis')
      assert.isFalse(runningFor(file))
    }).pipe(Effect.provide(ffmpegLive())),
  )

  it.live('타임아웃이면 FfmpegTimeout, 프로세스는 남지 않는다', () =>
    Effect.gen(function* () {
      const file = fixture('vp9.webm')
      const error = yield* collect((yield* Ffmpeg).frame(file, 3, 'png')).pipe(
        Effect.flip,
      )
      assert.strictEqual((error as { _tag: string })._tag, 'FfmpegTimeout')
      yield* Effect.sleep('200 millis')
      assert.isFalse(runningFor(file))
    }).pipe(Effect.provide(ffmpegLive({ ffmpegTimeout: Duration.millis(5) }))),
  )
})
