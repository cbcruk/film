import fs from 'node:fs'
import { Duration, Effect, Layer, Stream } from 'effect'
import { ExtractFailed } from '../../src/server/errors.ts'
import { Ffmpeg } from '../../src/server/ffmpeg.ts'

export interface FakeOptions {
  /** 썸네일 1장에 걸리는 시간 (기본 20ms) */
  readonly delay?: Duration.Input
  /** 끝나지 않는 썸네일 (취소 테스트용) */
  readonly hang?: boolean
  /** 이 시점이면 ExtractFailed */
  readonly failWhen?: (t: number) => boolean
  readonly duration?: number
  /** scenes()가 돌려줄 전환 후보 */
  readonly scenes?: ReadonlyArray<{ t: number; score: number }>
}

/** 호출 기록. 테스트에서 동시 실행 수·취소 여부를 확인한다 */
export interface FakeStats {
  calls: number
  sceneCalls: number
  active: number
  maxActive: number
  interrupted: number
}

export const ffmpegFake = (options: FakeOptions = {}) => {
  const stats: FakeStats = {
    calls: 0,
    sceneCalls: 0,
    active: 0,
    maxActive: 0,
    interrupted: 0,
  }

  const thumbnail = (_file: string, t: number, out: string) =>
    Effect.gen(function* () {
      stats.calls++
      stats.active++
      stats.maxActive = Math.max(stats.maxActive, stats.active)
      yield* options.hang
        ? Effect.never
        : Effect.sleep(options.delay ?? '20 millis')
      if (options.failWhen?.(t)) {
        return yield* new ExtractFailed({ message: 'fake 실패', t })
      }
      fs.writeFileSync(out, 'fake-jpeg')
    }).pipe(
      Effect.onInterrupt(() =>
        Effect.sync(() => {
          stats.interrupted++
        }),
      ),
      Effect.ensuring(
        Effect.sync(() => {
          stats.active--
        }),
      ),
    )

  const layer = Layer.succeed(
    Ffmpeg,
    Ffmpeg.of({
      checkInstalled: Effect.succeed('ffmpeg version fake'),
      formats: Effect.succeed(['png', 'jpg']),
      probe: () =>
        Effect.succeed({
          duration: options.duration ?? 100,
          width: 1920,
          height: 1080,
          fps: 30,
          codec: 'h264',
        }),
      thumbnail,
      frame: () => Stream.empty,
      scenes: () =>
        Effect.sync(() => {
          stats.sceneCalls++
          return options.scenes ?? []
        }),
    }),
  )
  return { layer, stats }
}
