/** source 머신의 실제 구현: 서버 함수 호출과 SSE 구독 */
import { fromCallback, fromPromise } from 'xstate'
import { createSet, openSource, retryThumb } from '../functions/sources.ts'
import { isTextEntry } from '../lib/keyboard.ts'
import { eventsUrl } from '../lib/timecode.ts'
import type { SourceEvent as ServerEvent } from '../lib/types.ts'
import { sourceActors, sourceMachine, toErrorBody } from './source.ts'
import type { SourceEvent } from './source.ts'

export const liveSourceMachine = sourceMachine.provide({
  actions: {
    revealSelected: ({ context }) =>
      document
        .getElementById(`thumb-${context.selected}`)
        ?.scrollIntoView({ block: 'nearest' }),
  },
  actors: {
    /**
     * ←/→ = 옆 썸네일, ,/. = ±1프레임, Shift+←/→ = ±1초.
     * 포커스 위치와 상관없이 window에서 듣는다 (Safari는 버튼을 클릭해도 포커스를 주지 않는다)
     */
    keyboard: fromCallback<SourceEvent, { fps: number }>(
      ({ input, sendBack }) => {
        const frame = 1 / (input.fps > 0 ? input.fps : 30)
        const onKeyDown = (e: KeyboardEvent) => {
          if (isTextEntry(e.target) || e.altKey || e.metaKey || e.ctrlKey)
            return
          const arrow =
            e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
          if (arrow !== 0) {
            e.preventDefault()
            sendBack(
              e.shiftKey
                ? { type: 'STEP', seconds: arrow }
                : { type: 'NAVIGATE', step: arrow },
            )
          } else if (e.key === ',' || e.key === '.') {
            e.preventDefault()
            sendBack({ type: 'STEP', seconds: e.key === ',' ? -frame : frame })
          }
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
      },
    ),

    openSource: fromPromise(({ input }) => openSource({ data: input })),

    createSet: fromPromise(({ input }) => createSet({ data: input })),

    retryThumb: fromCallback<
      SourceEvent,
      { id: string; setId: string; index: number }
    >(({ input, sendBack }) => {
      retryThumb({ data: input }).then(
        (result) => sendBack({ type: 'RETRIED', result }),
        (error: unknown) =>
          sendBack({
            type: 'RETRY_FAILED',
            index: input.index,
            message: toErrorBody(error).message,
          }),
      )
    }),

    stream: fromCallback<SourceEvent, { id: string; setId: string }>(
      ({ input, sendBack }) => {
        const source = new EventSource(eventsUrl(input.id))
        let finished = false

        const on = <T extends ServerEvent['type']>(
          type: T,
          handle: (event: Extract<ServerEvent, { type: T }>) => void,
        ) =>
          source.addEventListener(type, (e) => {
            // 'error'는 연결 오류와 이름이 같다. 서버가 보낸 이벤트만 data가 있다
            if (!(e instanceof MessageEvent) || typeof e.data !== 'string')
              return
            const event = JSON.parse(e.data) as Extract<
              ServerEvent,
              { type: T }
            >
            // 다른 세트의 이벤트는 무시
            if (event.setId === input.setId) handle(event)
          })

        on('thumb', (e) =>
          sendBack({
            type: 'THUMB',
            index: e.index,
            thumb: { status: 'ready', url: e.url },
          }),
        )
        on('error', (e) => {
          if (e.index === undefined) return
          sendBack({
            type: 'THUMB',
            index: e.index,
            thumb: { status: 'error', code: e.code, message: e.message },
          })
        })
        on('progress', (e) => sendBack({ type: 'PROGRESS', done: e.done }))
        on('done', () => {
          finished = true
          source.close() // 닫지 않으면 EventSource가 자동 재연결한다
          sendBack({ type: 'DONE' })
        })
        source.addEventListener('error', (e) => {
          if (e instanceof MessageEvent) return
          // 일시적 끊김은 브라우저가 재연결한다. CLOSED면 서버가 거부한 것 (404 등)
          if (!finished && source.readyState === EventSource.CLOSED)
            sendBack({ type: 'LOST' })
        })

        return () => source.close()
      },
    ),

    ticker: sourceActors.ticker,
    restoreFormat: sourceActors.restoreFormat,
  },
})
