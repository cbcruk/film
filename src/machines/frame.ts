/**
 * 원본 프레임 <img> 한 장의 로딩.
 *
 *   loading ─LOADED─▶ ready
 *      └────FAILED─▶ failed
 *
 * 주소가 바뀌면 화면이 새 머신을 만든다 (FramePreview의 key={src}).
 * 그래서 이전 이미지의 늦은 결과가 섞일 일이 없다.
 */
import { setup } from 'xstate'

export type FrameEvent = { type: 'LOADED' } | { type: 'FAILED' }

export const frameMachine = setup({
  types: {
    events: {} as FrameEvent,
  },
}).createMachine({
  id: 'frame',
  initial: 'loading',
  states: {
    loading: {
      on: {
        LOADED: 'ready',
        FAILED: 'failed',
      },
    },
    ready: {},
    failed: {},
  },
})
