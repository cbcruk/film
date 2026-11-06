import { useCallback, useEffect, useState } from 'react'
import { eventsUrl } from '../lib/timecode.ts'
import type { ErrorCode, RetryResult, SourceEvent } from '../lib/types.ts'

export type ThumbState =
  | { readonly status: 'ready'; readonly url: string }
  | {
      readonly status: 'error'
      readonly code: ErrorCode
      readonly message: string
    }

export interface SourceEventsState {
  /** 인덱스별 썸네일 상태 (아직 없으면 undefined → 스켈레톤) */
  readonly thumbs: ReadonlyArray<ThumbState | undefined>
  readonly done: number
  readonly total: number
  readonly finished: boolean
  /** 서버가 이 소스를 모른다 (서버 재시작 등) → openSource를 다시 호출해야 함 */
  readonly lost: boolean
  /** 재시도 결과처럼 SSE 밖에서 받은 이벤트를 반영한다 */
  readonly apply: (event: RetryResult) => void
}

type State = Omit<SourceEventsState, 'apply'>

const toThumb = (event: RetryResult): ThumbState =>
  event.type === 'thumb'
    ? { status: 'ready', url: event.url }
    : { status: 'error', code: event.code, message: event.message }

const withThumb = (s: State, index: number, thumb: ThumbState): State => {
  const thumbs = [...s.thumbs]
  thumbs[index] = thumb
  return { ...s, thumbs }
}

const initial = (total: number): State => ({
  thumbs: Array.from({ length: total }, () => undefined),
  done: 0,
  total,
  finished: false,
  lost: false,
})

/** SSE 구독. setId가 바뀌면 새로 구독한다 */
export const useSourceEvents = (
  id: string,
  setId: string,
  total: number,
): SourceEventsState => {
  const [state, setState] = useState(() => initial(total))

  useEffect(() => {
    setState(initial(total))
    const source = new EventSource(eventsUrl(id))

    const on = <T extends SourceEvent['type']>(
      type: T,
      handle: (event: Extract<SourceEvent, { type: T }>) => void,
    ) =>
      source.addEventListener(type, (e) => {
        // 'error'는 연결 오류와 이름이 같다. 서버가 보낸 이벤트만 data가 있다
        if (!(e instanceof MessageEvent) || typeof e.data !== 'string') return
        const event = JSON.parse(e.data) as Extract<SourceEvent, { type: T }>
        if (event.setId === setId) handle(event)
      })

    on('thumb', (e) => setState((s) => withThumb(s, e.index, toThumb(e))))
    on('error', (e) => {
      const { index } = e
      if (index !== undefined) {
        setState((s) => withThumb(s, index, toThumb({ ...e, index })))
      }
    })
    on('progress', (e) =>
      // 재연결 시 같은 이벤트가 다시 오므로 큰 값만 반영
      setState((s) => ({ ...s, done: Math.max(s.done, e.done) })),
    )
    on('done', () => {
      source.close() // 닫지 않으면 EventSource가 자동 재연결한다
      setState((s) => ({ ...s, finished: true }))
    })
    source.addEventListener('error', (e) => {
      if (e instanceof MessageEvent) return
      // 일시적 끊김은 브라우저가 재연결한다. CLOSED면 서버가 거부한 것 (404 등)
      if (source.readyState === EventSource.CLOSED) {
        setState((s) => (s.finished ? s : { ...s, lost: true }))
      }
    })

    return () => source.close()
  }, [id, setId, total])

  const apply = useCallback(
    (event: RetryResult) => {
      if (event.setId === setId) {
        setState((s) => withThumb(s, event.index, toThumb(event)))
      }
    },
    [setId],
  )

  return { ...state, apply }
}
