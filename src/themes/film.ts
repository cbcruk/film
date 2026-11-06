import { defineTheme } from '@astryxdesign/core/theme'
import { neutralTheme } from '@astryxdesign/theme-neutral'

const sans =
  '-apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", "Segoe UI", Roboto, Helvetica, Arial, sans-serif'

/**
 * neutral 테마에서 글꼴만 Noto Sans KR로 바꾼다 (글꼴 파일은 src/fonts.css).
 * typography는 확장 시 통째로 교체되므로 neutral의 크기 비율·제목 굵기를 그대로 옮겨 적는다.
 *
 * 수정 후: npx astryx theme build src/themes/film.ts
 */
export const filmTheme = defineTheme({
  name: 'film',
  extends: neutralTheme,
  typography: {
    scale: { base: 14, ratio: 1.2 },
    body: { family: 'Noto Sans KR', fallbacks: sans },
    heading: {
      family: 'Noto Sans KR',
      fallbacks: sans,
      weights: { 3: 'bold', 4: 'bold' },
    },
    code: {
      family: 'ui-monospace',
      fallbacks:
        '"SF Mono", Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    },
  },
})
