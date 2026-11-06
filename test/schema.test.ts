import { assert, describe, it } from '@effect/vitest'
import { Effect, Schema } from 'effect'
import {
  OpenSourceInput,
  SecondsFromString,
  decodeParams,
} from '../src/server/schema.ts'

const ok = (schema: Schema.Top, input: unknown) =>
  Schema.decodeUnknownExit(schema as never)(input)._tag === 'Success'

describe('schema', () => {
  it('OpenSourceInput', () => {
    const id = 'a1b2c3d4e5f60718'
    assert.isTrue(ok(OpenSourceInput, { id, interval: 10 }))
    assert.isTrue(ok(OpenSourceInput, { id, interval: 1, mode: 'scene' }))
    assert.isFalse(
      ok(OpenSourceInput, { id: 'A1B2C3D4E5F60718', interval: 10 }),
    )
    assert.isFalse(ok(OpenSourceInput, { id: '../etc/passwd', interval: 10 }))
    assert.isFalse(ok(OpenSourceInput, { id, interval: 3 }))
    assert.isFalse(ok(OpenSourceInput, { id, count: 12 }))
    assert.isFalse(ok(OpenSourceInput, { id, interval: 10, mode: 'x' }))
  })

  it('SecondsFromString', () => {
    assert.isTrue(ok(SecondsFromString, '12.345'))
    assert.isTrue(ok(SecondsFromString, '0'))
    for (const bad of ['-1', 'abc', 'Infinity', 'NaN', '']) {
      assert.isFalse(ok(SecondsFromString, bad), `'${bad}'`)
    }
  })

  it.effect('decodeParams 실패는 InvalidParam', () =>
    Effect.gen(function* () {
      const error = yield* decodeParams(SecondsFromString)('x').pipe(
        Effect.flip,
      )
      assert.strictEqual(error._tag, 'InvalidParam')
    }),
  )
})
