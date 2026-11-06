import '@tanstack/react-start/server-only'
import { NodeServices } from '@effect/platform-node'
import { Context, Effect, Layer, String } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import { FfmpegMissing } from './errors.ts'

// M0: 설치 확인만. probe / thumbnail / frame은 M1에서 추가한다.
export class Ffmpeg extends Context.Service<
  Ffmpeg,
  {
    /** `ffmpeg -version` 첫 줄. ffmpeg·ffprobe 중 하나라도 없으면 FfmpegMissing */
    readonly checkInstalled: Effect.Effect<string, FfmpegMissing>
  }
>()('film/server/Ffmpeg') {
  static readonly layer = Layer.effect(
    Ffmpeg,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner

      const firstLine = (cmd: string) =>
        spawner.lines(ChildProcess.make(cmd, ['-version'])).pipe(
          Effect.map((lines) => String.trim(lines[0] ?? '')),
          Effect.mapError(
            () =>
              new FfmpegMissing({
                message: `${cmd}를 실행할 수 없습니다. brew install ffmpeg`,
              }),
          ),
        )

      const checkInstalled = Effect.gen(function* () {
        const version = yield* firstLine('ffmpeg')
        yield* firstLine('ffprobe')
        return version
      })

      return Ffmpeg.of({ checkInstalled })
    }),
  ).pipe(Layer.provide(NodeServices.layer))
}
