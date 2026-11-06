import { createCsrfMiddleware, createStart } from '@tanstack/react-start'
import { serverErrorAdapter } from './lib/server-error.ts'

// 서버 함수(RPC)는 같은 출처 요청만 받는다. 서버 라우트(이미지·SSE)는 GET 전용이라 제외
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === 'serverFn',
})

export const startInstance = createStart(() => ({
  serializationAdapters: [serverErrorAdapter],
  requestMiddleware: [csrfMiddleware],
}))
