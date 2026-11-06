import '@tanstack/react-start/server-only'
import os from 'node:os'
import path from 'node:path'
import { NodeServices } from '@effect/platform-node'
import {
  Config,
  ConfigProvider,
  Context,
  Duration,
  Effect,
  Layer,
} from 'effect'

const expandHome = (p: string) =>
  p === '~' || p.startsWith('~/') ? path.join(os.homedir(), p.slice(1)) : p

export class AppConfig extends Context.Service<
  AppConfig,
  {
    readonly filmDir: string
    readonly cacheDir: string
    readonly concurrency: number
    readonly ffmpegTimeout: Duration.Duration
  }
>()('film/server/AppConfig') {
  static readonly layer = Layer.effect(
    AppConfig,
    Effect.gen(function* () {
      const filmDir = yield* Config.String('FILM_DIR').pipe(
        Config.withDefault('~/Movies'),
      )
      return AppConfig.of({
        filmDir: path.resolve(expandHome(filmDir)),
        cacheDir: path.join(os.homedir(), '.cache', 'film'),
        concurrency: Math.max(1, Math.floor(os.availableParallelism() / 2)),
        ffmpegTimeout: Duration.seconds(30),
      })
    }),
  )
}

// 환경변수를 먼저 보고, 없으면 .env 파일을 본다. .env가 없어도 실패하지 않는다.
export const configProviderLayer = (dotEnvPath = '.env') =>
  ConfigProvider.layer(
    ConfigProvider.fromDotEnv({ path: dotEnvPath }).pipe(
      Effect.map((dotEnv) =>
        ConfigProvider.orElse(ConfigProvider.fromEnv(), dotEnv),
      ),
      Effect.orElseSucceed(() => ConfigProvider.fromEnv()),
    ),
  ).pipe(Layer.provide(NodeServices.layer))
