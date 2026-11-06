import os from 'node:os'
import path from 'node:path'
import { NodeServices } from '@effect/platform-node'
import { Duration, Layer } from 'effect'
import { AppConfig } from '../../src/server/config.ts'
import { Ffmpeg } from '../../src/server/ffmpeg.ts'
import { Library } from '../../src/server/library.ts'

export const FIXTURES = path.resolve(import.meta.dirname, '../fixtures')
export const fixture = (name: string) => path.join(FIXTURES, name)

export const testConfig = (overrides: Partial<AppConfig['Service']> = {}) =>
  Layer.succeed(
    AppConfig,
    AppConfig.of({
      filmDir: FIXTURES,
      cacheDir: path.join(os.tmpdir(), 'film-test-cache'),
      concurrency: 2,
      ffmpegTimeout: Duration.seconds(30),
      sceneTimeout: Duration.seconds(60),
      cacheMaxBytes: 1024 ** 3,
      ...overrides,
    }),
  )

/** 실제 ffmpeg + NodeServices. 설정은 overrides로 바꿀 수 있다 */
export const ffmpegLive = (overrides?: Partial<AppConfig['Service']>) =>
  Ffmpeg.layer.pipe(
    Layer.provide(testConfig(overrides)),
    Layer.provideMerge(NodeServices.layer),
  )

export const libraryLive = (filmDir: string) =>
  Library.layer.pipe(
    Layer.provide(testConfig({ filmDir })),
    Layer.provide(NodeServices.layer),
  )
