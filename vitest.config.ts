import { defineConfig } from 'vitest/config'

// TanStack Start 플러그인 없이 서버 모듈(src/server, src/lib)만 테스트한다.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
})
