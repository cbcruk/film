import '@tanstack/react-start/server-only'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { Context, Effect, FileSystem, Layer, Option, Ref } from 'effect'
import type { VideoEntry } from '../lib/types.ts'
import { AppConfig } from './config.ts'
import { FileNotFound, LibraryNotFound } from './errors.ts'

export const VIDEO_EXTENSIONS: ReadonlySet<string> = new Set([
  '.mp4',
  '.webm',
  '.mkv',
  '.mov',
])

/** sha1(상대경로 + 크기 + 수정시각) 앞 16자. 파일이 바뀌면 ID도 바뀌어 캐시가 자동으로 갈린다 */
export const sourceId = (relative: string, size: number, mtimeMs: number) =>
  createHash('sha1')
    .update(`${relative}\0${size}\0${mtimeMs}`)
    .digest('hex')
    .slice(0, 16)

export class Library extends Context.Service<
  Library,
  {
    /** FILM_DIR 아래 영상 목록 (하위 폴더 포함, 숨김·심볼릭 링크 제외, 수정 시각 최신순) */
    readonly list: Effect.Effect<ReadonlyArray<VideoEntry>, LibraryNotFound>
    /** ID → 절대 경로. 실제 경로가 FILM_DIR 밖이거나 파일이 바뀌었으면 FileNotFound */
    readonly resolve: (id: string) => Effect.Effect<string, FileNotFound>
  }
>()('film/server/Library') {
  static readonly layer = Layer.effect(
    Library,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const { filmDir } = yield* AppConfig
      // 마지막 목록의 ID → 절대 경로
      const known = yield* Ref.make(new Map<string, string>())

      const libraryNotFound = new LibraryNotFound({
        message: `영상 폴더를 찾을 수 없습니다: ${filmDir}`,
        dir: filmDir,
      })

      const toEntry = (absolute: string) =>
        fs.stat(absolute).pipe(
          Effect.map((info) => {
            if (info.type !== 'File') return Option.none()
            const relative = path.relative(filmDir, absolute)
            const size = Number(info.size)
            const mtime = Option.getOrElse(info.mtime, () => new Date(0))
            const entry: VideoEntry = {
              id: sourceId(relative, size, mtime.getTime()),
              name: path.basename(absolute),
              folder:
                path.dirname(relative) === '.' ? '' : path.dirname(relative),
              size,
              mtime: mtime.toISOString(),
            }
            return Option.some({ entry, absolute })
          }),
          // 목록을 만드는 사이 지워진 파일 등은 건너뛴다
          Effect.orElseSucceed(() => Option.none()),
        )

      /** 하위 폴더까지 영상 파일 절대 경로를 모은다. 읽을 수 없는 하위 폴더는 건너뛴다 */
      const walk = (dir: string): Effect.Effect<ReadonlyArray<string>> =>
        fs.readDirectoryEntries(dir).pipe(
          Effect.orElseSucceed(() => []),
          Effect.flatMap((entries) =>
            Effect.forEach(
              entries.filter((e) => !e.name.startsWith('.')),
              (e): Effect.Effect<ReadonlyArray<string>> => {
                const absolute = path.join(dir, e.name)
                if (e.type === 'Directory') return walk(absolute)
                if (
                  e.type === 'File' &&
                  VIDEO_EXTENSIONS.has(path.extname(e.name).toLowerCase())
                ) {
                  return Effect.succeed([absolute])
                }
                // 심볼릭 링크는 따라가지 않는다 (폴더 밖을 가리킬 수 있음)
                return Effect.succeed([])
              },
              { concurrency: 8 },
            ),
          ),
          Effect.map((nested) => nested.flat()),
        )

      const list = Effect.gen(function* () {
        const info = yield* fs
          .stat(filmDir)
          .pipe(Effect.mapError(() => libraryNotFound))
        if (info.type !== 'Directory') return yield* libraryNotFound

        const files = yield* walk(filmDir)
        const found = (yield* Effect.forEach(files, toEntry, {
          concurrency: 16,
        })).flatMap(Option.toArray)

        yield* Ref.set(
          known,
          new Map(found.map(({ entry, absolute }) => [entry.id, absolute])),
        )
        return found
          .map(({ entry }) => entry)
          .sort((a, b) => b.mtime.localeCompare(a.mtime))
      }).pipe(Effect.withSpan('Library.list'))

      const resolve = Effect.fn('Library.resolve')(function* (id: string) {
        const notFound = new FileNotFound({
          message: '파일을 찾을 수 없습니다. 목록을 새로고침하세요',
        })

        // 서버가 다시 시작되어 대응표가 비었을 수 있으므로 한 번은 다시 탐색한다
        let absolute = (yield* Ref.get(known)).get(id)
        if (absolute === undefined) {
          yield* list.pipe(Effect.ignore)
          absolute = (yield* Ref.get(known)).get(id)
        }
        if (absolute === undefined) return yield* notFound

        const [real, root] = yield* Effect.all([
          fs.realPath(absolute),
          fs.realPath(filmDir),
        ]).pipe(Effect.mapError(() => notFound))
        if (!real.startsWith(root + path.sep)) return yield* notFound

        // 목록 이후 파일이 바뀌었으면 ID가 달라진다
        const current = yield* toEntry(absolute)
        if (Option.isNone(current) || current.value.entry.id !== id) {
          return yield* notFound
        }
        return real
      })

      return Library.of({ list, resolve })
    }),
  )
}
