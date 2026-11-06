import '@tanstack/react-start/server-only'
import { Effect, Schema } from 'effect'
import { InvalidParam } from './errors.ts'

// 8-3절 검증 규칙

export const SourceId = Schema.String.check(Schema.isPattern(/^[0-9a-f]{16}$/))

export const ThumbCount = Schema.Literals([6, 12, 24, 48])

/** 시점(초). URL 문자열에서 읽는다. 0 이상, 밀리초로 반올림. 영상 길이 확인은 사용하는 쪽에서 */
export const SecondsFromString = Schema.String.check(
  Schema.isPattern(/^\d+(\.\d+)?$/),
).pipe(
  Schema.decodeTo(
    Schema.FiniteFromString.check(Schema.isGreaterThanOrEqualTo(0)),
  ),
)

export const ThumbMode = Schema.Literals(['even', 'scene'])

export const OpenSourceInput = Schema.Struct({
  id: SourceId,
  count: ThumbCount,
  mode: Schema.optionalKey(ThumbMode),
})

/** 초 단위 시점 (JSON 숫자) */
export const Seconds = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))

export const CreateSetInput = Schema.Struct({
  id: SourceId,
  count: ThumbCount,
  from: Seconds,
  to: Seconds,
})

export const RetryInput = Schema.Struct({
  id: SourceId,
  setId: Schema.String.check(Schema.isPattern(/^s\d+$/)),
  index: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
})

/** 서버 라우트 파라미터 검증. 실패하면 InvalidParam (400) */
export const decodeParams =
  <S extends Schema.Top & { readonly DecodingServices: never }>(schema: S) =>
  (input: unknown): Effect.Effect<S['Type'], InvalidParam> =>
    Schema.decodeUnknownEffect(schema)(input).pipe(
      Effect.mapError(
        (e) => new InvalidParam({ message: `잘못된 요청: ${e.message}` }),
      ),
    ) as Effect.Effect<S['Type'], InvalidParam>
