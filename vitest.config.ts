import { defineConfig } from 'vitest/config'

// TanStack Start 플러그인 없이 서버 모듈(src/server, src/lib)만 테스트한다.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // 픽스처 영상을 ffmpeg로 생성 (test/fixtures/, git 제외)
    globalSetup: ['test/global-setup.ts'],
  },
})
