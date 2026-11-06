import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { AppConfig, configProviderLayer } from '../src/server/config.ts'

const withDotEnv = (contents: string | null) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'film-config-'))
  const file = path.join(dir, '.env')
  if (contents !== null) fs.writeFileSync(file, contents)
  return AppConfig.layer.pipe(Layer.provide(configProviderLayer(file)))
}

describe('AppConfig', () => {
  it.effect('.env의 FILM_DIR을 읽고 ~를 홈 디렉터리로 바꾼다', () =>
    Effect.gen(function* () {
      const config = yield* AppConfig
      assert.strictEqual(config.filmDir, path.join(os.homedir(), 'Movies/MV'))
    }).pipe(Effect.provide(withDotEnv('FILM_DIR=~/Movies/MV\n'))),
  )

  it.effect('.env가 없으면 기본값 ~/Movies', () =>
    Effect.gen(function* () {
      const config = yield* AppConfig
      assert.strictEqual(config.filmDir, path.join(os.homedir(), 'Movies'))
      assert.isTrue(config.concurrency >= 1)
    }).pipe(Effect.provide(withDotEnv(null))),
  )
})
