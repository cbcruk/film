import '@tanstack/react-start/server-only'
import {
  Context,
  Effect,
  Fiber,
  FileSystem,
  Layer,
  Schema,
  Stream,
  String,
} from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import type { FrameFormat, VideoMeta } from '../lib/types.ts'
import { AppConfig } from './config.ts'
import {
  ExtractFailed,
  FfmpegMissing,
  FfmpegTimeout,
  NotAVideo,
} from './errors.ts'

export class Ffmpeg extends Context.Service<
  Ffmpeg,
  {
    /** `ffmpeg -version` 첫 줄. ffmpeg·ffprobe 중 하나라도 없으면 FfmpegMissing */
    readonly checkInstalled: Effect.Effect<string, FfmpegMissing>
    /** 이 ffmpeg 빌드로 인코딩할 수 있는 저장 포맷 (예: Homebrew ffmpeg 9에는 libwebp가 없다). 한 번만 확인한다 */
    readonly formats: Effect.Effect<ReadonlyArray<FrameFormat>>
    /** 첫 비디오 스트림의 메타데이터. 비디오 스트림이 없거나 읽을 수 없으면 NotAVideo */
    readonly probe: (
      file: string,
    ) => Effect.Effect<VideoMeta, NotAVideo | FfmpegTimeout>
    /** t초 지점 썸네일(가로 320 JPEG)을 out에 쓴다. 임시 파일 → rename으로 원자적 교체 */
    readonly thumbnail: (
      file: string,
      t: number,
      out: string,
    ) => Effect.Effect<void, ExtractFailed | FfmpegTimeout>
    /** t초 지점 원본 해상도 프레임. ffmpeg stdout을 그대로 흘려보낸다. 스트림이 끝나거나 중단되면 프로세스 종료.
     *  format은 formats에 있는 것이어야 한다 (호출 전 검증) */
    readonly frame: (
      file: string,
      t: number,
      format: FrameFormat,
    ) => Stream.Stream<Uint8Array, ExtractFailed | FfmpegTimeout>
  }
>()('film/server/Ffmpeg') {
  static readonly layer = Layer.effect(
    Ffmpeg,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const fs = yield* FileSystem.FileSystem
      const { ffmpegTimeout } = yield* AppConfig

      const timeoutError = (cmd: string) =>
        new FfmpegTimeout({
          message: `${cmd}가 ${ffmpegTimeout} 안에 끝나지 않았습니다`,
        })

      /** 실행 후 stdout·stderr를 모아서 종료 코드와 함께 돌려준다. 타임아웃 시 프로세스 kill */
      const run = (cmd: string, args: ReadonlyArray<string>) =>
        Effect.scoped(
          Effect.gen(function* () {
            const handle = yield* spawner.spawn(ChildProcess.make(cmd, args))
            const [stdout, stderr, exitCode] = yield* Effect.all(
              [
                Stream.mkString(Stream.decodeText(handle.stdout)),
                Stream.mkString(Stream.decodeText(handle.stderr)),
                handle.exitCode,
              ],
              { concurrency: 'unbounded' },
            )
            return { stdout, stderr: String.trim(stderr), exitCode }
          }),
        ).pipe(
          Effect.timeoutOrElse({
            duration: ffmpegTimeout,
            orElse: () => Effect.fail(timeoutError(cmd)),
          }),
        )

      const firstLine = (cmd: string) =>
        run(cmd, ['-version']).pipe(
          Effect.filterOrFail(
            (r) => r.exitCode === 0,
            () => new Error('nonzero exit'),
          ),
          Effect.map((r) => String.trim(r.stdout.split('\n')[0] ?? '')),
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

      const formats = yield* Effect.cached(
        run('ffmpeg', ['-hide_banner', '-encoders']).pipe(
          Effect.map((r) => {
            const encoders = new Set(
              r.stdout.split('\n').map((line) => line.trim().split(/\s+/)[1]),
            )
            return FRAME_FORMATS.filter((f) => encoders.has(encoderArgs[f][1]))
          }),
          Effect.orElseSucceed((): ReadonlyArray<FrameFormat> => []),
        ),
      )

      const probe = Effect.fn('Ffmpeg.probe')(function* (file: string) {
        const notAVideo = (detail: string) =>
          new NotAVideo({ message: `영상 정보를 읽을 수 없습니다: ${detail}` })

        const result = yield* run('ffprobe', [
          '-v',
          'error',
          '-select_streams',
          'v:0',
          '-show_entries',
          'format=duration:stream=width,height,codec_name,avg_frame_rate:stream_side_data=rotation',
          '-of',
          'json',
          file,
        ]).pipe(
          Effect.catchTag('PlatformError', (e) =>
            Effect.fail(notAVideo(e.message)),
          ),
        )
        if (result.exitCode !== 0) {
          return yield* notAVideo(result.stderr || `exit ${result.exitCode}`)
        }

        const output = yield* decodeProbe(result.stdout).pipe(
          Effect.mapError(() => notAVideo('ffprobe 출력 형식이 다릅니다')),
        )
        const stream = output.streams[0]
        if (stream === undefined) return yield* notAVideo('비디오 스트림 없음')

        const duration = Number(output.format?.duration)
        if (!Number.isFinite(duration) || duration <= 0) {
          return yield* notAVideo('길이를 알 수 없음')
        }

        const rotation = stream.side_data_list?.find(
          (d) => d.rotation !== undefined,
        )?.rotation
        const sideways =
          rotation !== undefined && Math.abs(rotation) % 180 === 90

        return {
          duration,
          width: sideways ? stream.height : stream.width,
          height: sideways ? stream.width : stream.height,
          fps: parseRate(stream.avg_frame_rate),
          codec: stream.codec_name,
        } satisfies VideoMeta
      })

      const thumbnail = Effect.fn('Ffmpeg.thumbnail')(function* (
        file: string,
        t: number,
        out: string,
      ) {
        const failed = (detail: string) =>
          new ExtractFailed({ message: `썸네일 추출 실패: ${detail}`, t })

        // 확장자로 ffmpeg가 형식을 판단하므로 임시 파일도 .jpg로 끝나야 한다
        const tmp = `${out}.${process.pid}-${Math.random().toString(36).slice(2)}.tmp.jpg`
        yield* Effect.gen(function* () {
          const result = yield* run('ffmpeg', [
            '-v',
            'error',
            '-ss',
            seconds(t),
            '-i',
            file,
            '-frames:v',
            '1',
            '-vf',
            'scale=320:-2',
            '-q:v',
            '4',
            '-y',
            tmp,
          ])
          if (result.exitCode !== 0) {
            return yield* failed(result.stderr || `exit ${result.exitCode}`)
          }
          // 영상 끝을 넘긴 시점이면 ffmpeg가 성공으로 끝나도 파일이 없다
          const written = yield* fs.exists(tmp)
          if (!written) return yield* failed('프레임이 없습니다')
          yield* fs.rename(tmp, out)
        }).pipe(
          Effect.catchTag('PlatformError', (e) =>
            Effect.fail(failed(e.message)),
          ),
          Effect.onError(() => fs.remove(tmp).pipe(Effect.ignore)),
        )
      })

      const frame = (file: string, t: number, format: FrameFormat) => {
        const failed = (detail: string) =>
          new ExtractFailed({ message: `프레임 추출 실패: ${detail}`, t })

        return Stream.unwrap(
          Effect.gen(function* () {
            const handle = yield* spawner.spawn(
              ChildProcess.make('ffmpeg', [
                '-v',
                'error',
                '-ss',
                seconds(t),
                '-i',
                file,
                '-frames:v',
                '1',
                '-f',
                'image2pipe',
                ...encoderArgs[format],
                'pipe:1',
              ]),
            )
            // stderr를 읽지 않으면 파이프가 차서 ffmpeg가 멈출 수 있다
            const stderr = yield* Stream.mkString(
              Stream.decodeText(handle.stderr),
            ).pipe(Effect.forkScoped)

            let bytes = 0
            const finish = Effect.gen(function* () {
              const exitCode = yield* handle.exitCode
              if (exitCode !== 0 || bytes === 0) {
                const message = String.trim(
                  yield* Fiber.join(stderr).pipe(
                    Effect.orElseSucceed(() => ''),
                  ),
                )
                return yield* failed(
                  message ||
                    (exitCode !== 0 ? `exit ${exitCode}` : '프레임이 없습니다'),
                )
              }
            })

            return handle.stdout.pipe(
              Stream.tap((chunk) =>
                Effect.sync(() => {
                  bytes += chunk.length
                }),
              ),
              Stream.concat(Stream.fromEffectDrain(finish)),
            )
          }),
        ).pipe(
          Stream.mapError((e) =>
            e._tag === 'PlatformError' ? failed(e.message) : e,
          ),
          Stream.interruptWhen(
            Effect.sleep(ffmpegTimeout).pipe(
              Effect.andThen(Effect.fail(timeoutError('ffmpeg'))),
            ),
          ),
        )
      }

      return Ffmpeg.of({ checkInstalled, formats, probe, thumbnail, frame })
    }),
  )
}

const ProbeOutput = Schema.Struct({
  streams: Schema.Array(
    Schema.Struct({
      codec_name: Schema.String,
      width: Schema.Number,
      height: Schema.Number,
      avg_frame_rate: Schema.String,
      side_data_list: Schema.optional(
        Schema.Array(
          Schema.Struct({ rotation: Schema.optional(Schema.Number) }),
        ),
      ),
    }),
  ),
  format: Schema.optional(
    Schema.Struct({ duration: Schema.optional(Schema.String) }),
  ),
})
const decodeProbe = Schema.decodeUnknownEffect(
  Schema.fromJsonString(ProbeOutput),
)

/** "30000/1001" → 29.97, "0/0" → 0 */
const parseRate = (rate: string): number => {
  const [num, den] = rate.split('/').map(Number)
  if (num === undefined || !Number.isFinite(num)) return 0
  if (den === undefined) return num
  return den > 0 && Number.isFinite(den)
    ? Math.round((num / den) * 1000) / 1000
    : 0
}

/** ffmpeg -ss 인자. 밀리초 단위로 고정해 같은 시점은 항상 같은 문자열이 되게 한다 */
const seconds = (t: number) => t.toFixed(3)

const FRAME_FORMATS: ReadonlyArray<FrameFormat> = ['png', 'jpg', 'webp']

// [-c:v, 인코더 이름, ...옵션] — formats가 인코더 이름(인덱스 1)으로 지원 여부를 확인한다
const encoderArgs: Record<FrameFormat, ReadonlyArray<string>> = {
  png: ['-c:v', 'png'],
  jpg: ['-c:v', 'mjpeg', '-q:v', '2'],
  webp: ['-c:v', 'libwebp', '-quality', '90'],
}
