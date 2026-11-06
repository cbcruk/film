import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { Library } from '../src/server/library.ts'
import { libraryLive } from './support/layers.ts'

const day = 24 * 60 * 60 * 1000

/** 파일을 만들고 수정 시각을 now - ageDays로 맞춘다 */
const touch = (file: string, ageDays: number) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, 'x')
  const time = new Date(Date.now() - ageDays * day)
  fs.utimesSync(file, time, time)
}

const makeLibrary = () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'film-library-'))
  const root = path.join(base, 'MV')
  const outside = path.join(base, 'outside')

  touch(path.join(root, 'old.mp4'), 30)
  touch(path.join(root, '2026/11/newest.webm'), 1)
  touch(path.join(root, 'UPPER.MOV'), 10)
  touch(path.join(root, 'clip.mkv'), 20)
  touch(path.join(root, 'notes.txt'), 0)
  touch(path.join(root, '.hidden.mp4'), 0)
  touch(path.join(root, '.cache/inside-hidden-dir.mp4'), 0)
  touch(path.join(outside, 'secret.mp4'), 0)
  fs.symlinkSync(path.join(outside, 'secret.mp4'), path.join(root, 'link.mp4'))
  fs.symlinkSync(outside, path.join(root, 'linked-dir'))

  return { root, outside }
}

describe('Library.list', () => {
  const { root } = makeLibrary()

  it.effect(
    '영상 확장자만, 하위 폴더 포함, 숨김·심볼릭 링크 제외, 최신순',
    () =>
      Effect.gen(function* () {
        const videos = yield* (yield* Library).list
        assert.deepStrictEqual(
          videos.map((v) => [v.folder, v.name]),
          [
            ['2026/11', 'newest.webm'],
            ['', 'UPPER.MOV'],
            ['', 'clip.mkv'],
            ['', 'old.mp4'],
          ],
        )
        for (const v of videos) assert.match(v.id, /^[0-9a-f]{16}$/)
        assert.strictEqual(videos[0]?.size, 1)
      }).pipe(Effect.provide(libraryLive(root))),
  )

  it.effect('FILM_DIR이 없으면 LibraryNotFound', () =>
    Effect.gen(function* () {
      const error = yield* (yield* Library).list.pipe(Effect.flip)
      assert.strictEqual(error._tag, 'LibraryNotFound')
    }).pipe(Effect.provide(libraryLive(path.join(root, 'nope')))),
  )

  it.effect('FILM_DIR이 파일이면 LibraryNotFound', () =>
    Effect.gen(function* () {
      const error = yield* (yield* Library).list.pipe(Effect.flip)
      assert.strictEqual(error._tag, 'LibraryNotFound')
    }).pipe(Effect.provide(libraryLive(path.join(root, 'old.mp4')))),
  )
})

describe('Library.resolve', () => {
  it.effect('목록의 ID를 실제 절대 경로로 바꾼다', () =>
    Effect.gen(function* () {
      const { root } = makeLibrary()
      const library = yield* Library.pipe(Effect.provide(libraryLive(root)))
      const videos = yield* library.list
      const newest = videos.find((v) => v.name === 'newest.webm')!
      const resolved = yield* library.resolve(newest.id)
      assert.strictEqual(
        resolved,
        fs.realpathSync(path.join(root, '2026/11/newest.webm')),
      )
    }),
  )

  it.effect('목록을 아직 안 불렀어도(서버 재시작) 다시 탐색해서 찾는다', () =>
    Effect.gen(function* () {
      const { root } = makeLibrary()
      const ids = yield* Effect.flatMap(Library, (l) => l.list).pipe(
        Effect.provide(libraryLive(root)),
      )
      const fresh = yield* Library.pipe(Effect.provide(libraryLive(root)))
      const resolved = yield* fresh.resolve(ids[0]!.id)
      assert.isTrue(resolved.endsWith('newest.webm'))
    }),
  )

  it.effect('모르는 ID, 삭제·수정된 파일은 FileNotFound', () =>
    Effect.gen(function* () {
      const { root } = makeLibrary()
      const library = yield* Library.pipe(Effect.provide(libraryLive(root)))
      const videos = yield* library.list
      const byName = (name: string) => videos.find((v) => v.name === name)!.id

      const unknown = yield* library
        .resolve('0123456789abcdef')
        .pipe(Effect.flip)
      assert.strictEqual(unknown._tag, 'FileNotFound')

      fs.rmSync(path.join(root, 'old.mp4'))
      const deleted = yield* library
        .resolve(byName('old.mp4'))
        .pipe(Effect.flip)
      assert.strictEqual(deleted._tag, 'FileNotFound')

      fs.appendFileSync(path.join(root, 'clip.mkv'), 'more')
      const changed = yield* library
        .resolve(byName('clip.mkv'))
        .pipe(Effect.flip)
      assert.strictEqual(changed._tag, 'FileNotFound')
    }),
  )

  it.effect('목록 이후 폴더가 밖을 가리키는 링크로 바뀌면 FileNotFound', () =>
    Effect.gen(function* () {
      const { root, outside } = makeLibrary()
      const library = yield* Library.pipe(Effect.provide(libraryLive(root)))
      const videos = yield* library.list
      const newest = videos.find((v) => v.name === 'newest.webm')!

      // 같은 상대 경로·크기·수정 시각의 파일을 폴더 밖에 두고 링크로 바꿔치기
      const original = path.join(root, '2026/11/newest.webm')
      const moved = path.join(outside, '2026/11/newest.webm')
      fs.mkdirSync(path.dirname(moved), { recursive: true })
      fs.renameSync(original, moved)
      fs.rmSync(path.join(root, '2026'), { recursive: true })
      fs.symlinkSync(path.join(outside, '2026'), path.join(root, '2026'))

      const error = yield* library.resolve(newest.id).pipe(Effect.flip)
      assert.strictEqual(error._tag, 'FileNotFound')
    }),
  )
})
