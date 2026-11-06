/**
 * 원본 프레임 <img> 로딩.
 *
 *   loading ─LOADED─▶ ready
 *      └────FAILED─▶ failed        (어느 상태든 SHOW로 새 주소 → loading)
 *
 * 앞서 요청한 이미지의 늦은 onLoad/onError는 주소가 다르면 무시한다.
 */
import { assign, setup } from 'xstate'

export interface FrameContext {
  readonly src: string
}

export type FrameEvent =
  | { type: 'SHOW'; src: string }
  | { type: 'LOADED'; src: string }
  | { type: 'FAILED'; src: string }

export const frameMachine = setup({
  types: {
    input: {} as { src: string },
    context: {} as FrameContext,
    events: {} as FrameEvent,
  },
  guards: {
    isCurrent: ({ context, event }) =>
      event.type !== 'SHOW' && event.src === context.src,
    isNew: ({ context, event }) =>
      event.type === 'SHOW' && event.src !== context.src,
  },
}).createMachine({
  id: 'frame',
  context: ({ input }) => ({ src: input.src }),
  on: {
    SHOW: {
      guard: 'isNew',
      target: '.loading',
      actions: assign({ src: ({ event }) => event.src }),
    },
  },
  initial: 'loading',
  states: {
    loading: {
      on: {
        LOADED: { guard: 'isCurrent', target: 'ready' },
        FAILED: { guard: 'isCurrent', target: 'failed' },
      },
    },
    ready: {},
    failed: {},
  },
})
