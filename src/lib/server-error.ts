import { createSerializationAdapter } from '@tanstack/react-router'
import type { ErrorBody, ErrorCode } from './types.ts'

/**
 * 서버 함수가 던지는 에러. 기본 직렬화는 message만 전달하므로,
 * 직렬화 어댑터(src/start.ts에 등록)로 code까지 클라이언트에 전달한다.
 */
export class ServerError extends Error {
  readonly code: ErrorCode
  constructor(body: ErrorBody) {
    super(body.message)
    this.name = 'ServerError'
    this.code = body.code
  }
}

export const serverErrorAdapter = createSerializationAdapter({
  key: 'film/ServerError',
  test: (value): value is ServerError => value instanceof ServerError,
  toSerializable: (error) => ({ code: error.code, message: error.message }),
  fromSerializable: (body) => new ServerError(body),
})
