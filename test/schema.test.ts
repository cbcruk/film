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
    assert.isTrue(ok(OpenSourceInput, { id: 'a1b2c3d4e5f60718', count: 12 }))
    assert.isFalse(ok(OpenSourceInput, { id: 'A1B2C3D4E5F60718', count: 12 }))
    assert.isFalse(ok(OpenSourceInput, { id: '../etc/passwd', count: 12 }))
    assert.isFalse(ok(OpenSourceInput, { id: 'a1b2c3d4e5f60718', count: 13 }))
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
