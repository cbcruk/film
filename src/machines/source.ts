/**
 * 영상 하나를 연 동안의 흐름.
 *
 *   opening ──성공──▶ ready ──────────────────────────────┐
 *     │                │  stream: streaming ─DONE─▶ finished │
 *     │                │  task:   idle ─MORE/FULL─▶ changingSet ─성공─▶ (ready를 새 세트로 다시 시작)
 *     │                └─ 서버가 소스를 잃음(LOST) ─▶ reopening ─성공─▶ ready
 *     └──실패──▶ failed                                  └─실패/횟수 초과─▶ failed
 *
 * 서버 호출·SSE 구독은 actors로 선언만 하고, 실제 구현은 source.live.ts가 끼워 넣는다
 * (테스트는 가짜 구현을 넣는다).
 */
import {
  assign,
  enqueueActions,
  fromCallback,
  fromPromise,
  setup,
  spawnChild,
  stopChild,
} from 'xstate'
import { thumbUrl } from '../lib/timecode.ts'
import type {
  ErrorBody,
  ErrorCode,
  FrameFormat,
  RetryResult,
  SourceInfo,
  ThumbCount,
  ThumbInterval,
  ThumbMode,
} from '../lib/types.ts'

/** [이 구간 더 보기]로 나누는 장수 */
export const RANGE_COUNT: ThumbCount = 12
/** 서버가 소스를 잃었을 때(재시작 등) 연달아 다시 여는 최대 횟수 */
export const MAX_REOPEN = 3

export type ThumbState =
  | { readonly status: 'ready'; readonly url: string }
  | {
      readonly status: 'error'
      readonly code: ErrorCode
      readonly message: string
    }

export interface SourceInput {
  readonly id: string
  readonly interval: ThumbInterval
  readonly mode: ThumbMode
  /** 이 ffmpeg가 만들 수 있는 저장 포맷 */
  readonly formats: ReadonlyArray<FrameFormat>
}

export interface SourceContext extends SourceInput {
  readonly info: SourceInfo | undefined
  /** 인덱스별 썸네일 (아직 없으면 undefined → 스켈레톤) */
  readonly thumbs: ReadonlyArray<ThumbState | undefined>
  readonly done: number
  /** 선택한 썸네일 */
  readonly selected: number | undefined
  /** 선택한 썸네일 기준 ±이동량 (초) */
  readonly offset: number
  readonly format: FrameFormat
  /** 다시 만드는 중인 칸 */
  readonly retrying: ReadonlySet<number>
  /** 열기 실패 (화면 전체를 오류로) */
  readonly failure: ErrorBody | undefined
  /** 구간 만들기·재시도 실패 (화면은 유지하고 알림만) */
  readonly notice: string | undefined
  /** 장면 분석 등 열기에 걸린 시간 (초) */
  readonly elapsed: number
  readonly reopenCount: number
}

/** SSE에서 오는 일 */
export type StreamEvent =
  | { type: 'THUMB'; index: number; thumb: ThumbState }
  | { type: 'PROGRESS'; done: number }
  | { type: 'DONE' }
  | { type: 'LOST' }

export type SourceEvent =
  | StreamEvent
  | { type: 'SELECT'; index: number | undefined }
  /** 키보드 ←/→: 옆 썸네일로 (선택이 없으면 첫 칸) */
  | { type: 'NAVIGATE'; step: 1 | -1 }
  /** 미리보기 시점을 seconds만큼 옮긴다 (±1프레임·±1초) */
  | { type: 'STEP'; seconds: number }
  | { type: 'FORMAT'; format: FrameFormat }
  /** 선택한 칸의 앞뒤 썸네일 사이를 다시 나눈다 */
  | { type: 'MORE' }
  /** 구간 보기를 끝내고 처음 세트로 */
  | { type: 'FULL' }
  | { type: 'RETRY'; index: number }
  | { type: 'RETRIED'; result: RetryResult }
  | { type: 'RETRY_FAILED'; index: number; message: string }
  | { type: 'TICK' }
  /** 이 브라우저에 저장된 포맷을 읽었다 */
  | { type: 'RESTORED'; format: FrameFormat }

const FORMAT_KEY = 'film.format'

export const toErrorBody = (error: unknown): ErrorBody =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  typeof error.code === 'string' &&
  'message' in error &&
  typeof error.message === 'string'
    ? { code: error.code as ErrorCode, message: error.message }
    : { code: 'INTERNAL', message: String(error) }

const toThumb = (result: RetryResult): ThumbState =>
  result.type === 'thumb'
    ? { status: 'ready', url: result.url }
    : { status: 'error', code: result.code, message: result.message }

const withThumb = (
  thumbs: ReadonlyArray<ThumbState | undefined>,
  index: number,
  thumb: ThumbState,
) => thumbs.map((t, i) => (i === index ? thumb : t))

const without = (set: ReadonlySet<number>, index: number) => {
  const next = new Set(set)
  next.delete(index)
  return next
}

const nextIndex = (selected: number | undefined, step: 1 | -1) =>
  selected === undefined ? 0 : selected + step

const retryId = (index: number) => `retry-${index}`

const defaultFormat = (formats: ReadonlyArray<FrameFormat>): FrameFormat =>
  formats.includes('png') ? 'png' : (formats[0] ?? 'png')

/** 새 세트를 받았을 때: 썸네일·진행률·선택을 비운다 */
/** 새 세트로 시작. 캐시에 있던 칸은 SSE를 기다리지 않고 바로 채운다 */
const freshSet = (info: SourceInfo) => {
  const cached = new Set(info.cached)
  return {
    info,
    thumbs: info.times.map((t, index): ThumbState | undefined =>
      cached.has(index)
        ? { status: 'ready', url: thumbUrl(info.id, t) }
        : undefined,
    ),
    done: cached.size,
    selected: undefined,
    offset: 0,
    retrying: new Set<number>(),
  }
}

/** 서버 호출과 SSE 구독. 입력·출력 타입만 정해 두고 구현은 source.live.ts */
export const sourceActors = {
  openSource: fromPromise<
    SourceInfo,
    { id: string; interval: ThumbInterval; mode: ThumbMode }
  >(() => Promise.reject(new Error('openSource 구현이 없습니다'))),
  createSet: fromPromise<
    SourceInfo,
    { id: string; count: ThumbCount; from: number; to: number }
  >(() => Promise.reject(new Error('createSet 구현이 없습니다'))),
  retryThumb: fromCallback<
    SourceEvent,
    { id: string; setId: string; index: number }
  >(() => {
    throw new Error('retryThumb 구현이 없습니다')
  }),
  /** 세트의 SSE를 구독해 StreamEvent를 보낸다 */
  stream: fromCallback<SourceEvent, { id: string; setId: string }>(() => {
    throw new Error('stream 구현이 없습니다')
  }),
  /**
   * 저장된 포맷을 읽어 RESTORED로 보낸다.
   * 머신이 시작된 뒤(화면이 서버 HTML과 맞춰진 뒤)에 실행되어야 해서 entry가 아닌 작업으로 둔다
   */
  restoreFormat: fromCallback<SourceEvent>(({ sendBack }) => {
    try {
      const saved = localStorage.getItem(FORMAT_KEY)
      if (saved === 'png' || saved === 'jpg' || saved === 'webp')
        sendBack({ type: 'RESTORED', format: saved })
    } catch {
      // 저장소를 못 쓰면 기본값 그대로
    }
  }),
  /** 단축키를 듣고 NAVIGATE·STEP을 보낸다 (썸네일이 준비된 동안만). 구현은 source.live.ts */
  keyboard: fromCallback<SourceEvent, { fps: number }>(() => {}),
  /** 1초마다 TICK */
  ticker: fromCallback<SourceEvent>(({ sendBack }) => {
    const timer = setInterval(() => sendBack({ type: 'TICK' }), 1000)
    return () => clearInterval(timer)
  }),
}

export const sourceMachine = setup({
  types: {
    input: {} as SourceInput,
    context: {} as SourceContext,
    events: {} as SourceEvent,
  },
  actors: sourceActors,
  guards: {
    canNavigate: ({ context, event }) => {
      if (event.type !== 'NAVIGATE' || context.info === undefined) return false
      const next = nextIndex(context.selected, event.step)
      return next >= 0 && next < context.info.times.length
    },
    canReopen: ({ context }) => context.reopenCount < MAX_REOPEN,
    hasSelection: ({ context }) => context.selected !== undefined,
  },
  actions: {
    /** 처음 열기에 성공했다 (최근 목록 등). 화면이 구현을 넣는다 */
    opened: () => {},
    /** 선택한 칸이 보이게 스크롤. 구현은 source.live.ts */
    revealSelected: () => {},
    saveFormat: ({ context }) => {
      try {
        localStorage.setItem(FORMAT_KEY, context.format)
      } catch {
        // 저장 공간 문제 등은 무시 (편의 기능)
      }
    },
  },
}).createMachine({
  id: 'source',
  context: ({ input }) => ({
    ...input,
    info: undefined,
    thumbs: [],
    done: 0,
    selected: undefined,
    offset: 0,
    format: defaultFormat(input.formats),
    retrying: new Set(),
    failure: undefined,
    notice: undefined,
    elapsed: 0,
    reopenCount: 0,
  }),
  invoke: { src: 'restoreFormat' },
  on: {
    // 이 ffmpeg가 만들 수 있는 포맷일 때만
    RESTORED: {
      guard: ({ context, event }) => context.formats.includes(event.format),
      actions: assign({ format: ({ event }) => event.format }),
    },
    FORMAT: {
      actions: [assign({ format: ({ event }) => event.format }), 'saveFormat'],
    },
  },
  initial: 'opening',
  states: {
    opening: {
      entry: assign({ elapsed: 0 }),
      invoke: [
        {
          src: 'openSource',
          input: ({ context: { id, interval, mode } }) => ({
            id,
            interval,
            mode,
          }),
          onDone: {
            target: 'ready',
            actions: [assign(({ event }) => freshSet(event.output)), 'opened'],
          },
          onError: {
            target: 'failed',
            actions: assign({
              failure: ({ event }) => toErrorBody(event.error),
            }),
          },
        },
        { src: 'ticker' },
      ],
      on: {
        TICK: {
          actions: assign({ elapsed: ({ context }) => context.elapsed + 1 }),
        },
      },
    },

    ready: {
      type: 'parallel',
      invoke: {
        src: 'keyboard',
        input: ({ context }) => ({ fps: context.info?.fps ?? 30 }),
      },
      on: {
        NAVIGATE: {
          guard: 'canNavigate',
          actions: [
            assign({
              selected: ({ context, event }) =>
                nextIndex(context.selected, event.step),
              offset: 0,
            }),
            'revealSelected',
          ],
        },
        SELECT: {
          actions: assign({
            selected: ({ event }) => event.index,
            offset: 0,
          }),
        },
        STEP: {
          guard: 'hasSelection',
          actions: assign({
            offset: ({ context, event }) => context.offset + event.seconds,
          }),
        },
        THUMB: {
          actions: assign({
            thumbs: ({ context, event }) =>
              withThumb(context.thumbs, event.index, event.thumb),
          }),
        },
        // 재연결 시 같은 진행률이 다시 오므로 큰 값만 반영
        PROGRESS: {
          actions: assign({
            done: ({ context, event }) => Math.max(context.done, event.done),
          }),
        },
        RETRY: {
          guard: ({ context, event }) => !context.retrying.has(event.index),
          // 칸마다 따로 실행된다 (여러 칸을 동시에 재시도할 수 있다)
          actions: enqueueActions(({ context, event, enqueue }) => {
            if (event.type !== 'RETRY' || context.info === undefined) return
            enqueue.assign({
              retrying: new Set(context.retrying).add(event.index),
            })
            enqueue.spawnChild('retryThumb', {
              id: retryId(event.index),
              input: {
                id: context.id,
                setId: context.info.setId,
                index: event.index,
              },
            })
          }),
        },
        RETRIED: {
          actions: [
            stopChild(({ event }) => retryId(event.result.index)),
            assign(({ context, event }) =>
              // 그사이 세트가 바뀌었으면 결과는 버린다
              event.result.setId === context.info?.setId
                ? {
                    thumbs: withThumb(
                      context.thumbs,
                      event.result.index,
                      toThumb(event.result),
                    ),
                    retrying: without(context.retrying, event.result.index),
                  }
                : {},
            ),
          ],
        },
        RETRY_FAILED: {
          actions: [
            stopChild(({ event }) => retryId(event.index)),
            assign({
              retrying: ({ context, event }) =>
                without(context.retrying, event.index),
              notice: ({ event }) => event.message,
            }),
          ],
        },
      },
      states: {
        stream: {
          initial: 'streaming',
          states: {
            streaming: {
              invoke: {
                src: 'stream',
                input: ({ context }) => ({
                  id: context.id,
                  setId: context.info?.setId ?? '',
                }),
              },
              on: {
                DONE: {
                  target: 'finished',
                  actions: assign({ reopenCount: 0 }),
                },
                LOST: [
                  { guard: 'canReopen', target: '#source.reopening' },
                  {
                    target: '#source.failed',
                    actions: assign({
                      failure: {
                        code: 'FILE_NOT_FOUND',
                        message:
                          '서버와 연결이 계속 끊깁니다. 다시 열어 주세요.',
                      },
                    }),
                  },
                ],
              },
            },
            finished: {},
          },
        },
        task: {
          initial: 'idle',
          states: {
            idle: {
              on: {
                MORE: { guard: 'hasSelection', target: 'creatingSet' },
                FULL: { target: 'restoringFull' },
              },
            },
            creatingSet: {
              entry: assign({ notice: undefined }),
              invoke: {
                src: 'createSet',
                // 선택한 칸의 앞뒤 썸네일 사이 (끝 칸이면 세트 구간·영상 끝까지)
                input: ({ context }) => {
                  const info = context.info as SourceInfo
                  const i = context.selected ?? 0
                  return {
                    id: info.id,
                    count: RANGE_COUNT,
                    from: info.times[i - 1] ?? info.range?.from ?? 0,
                    to: info.times[i + 1] ?? info.range?.to ?? info.duration,
                  }
                },
                onDone: {
                  target: '#source.ready',
                  reenter: true,
                  actions: assign(({ event }) => freshSet(event.output)),
                },
                onError: {
                  target: 'idle',
                  actions: assign({
                    notice: ({ event }) => toErrorBody(event.error).message,
                  }),
                },
              },
            },
            restoringFull: {
              entry: assign({ notice: undefined }),
              invoke: {
                src: 'openSource',
                input: ({ context: { id, interval, mode } }) => ({
                  id,
                  interval,
                  mode,
                }),
                onDone: {
                  target: '#source.ready',
                  reenter: true,
                  actions: assign(({ event }) => freshSet(event.output)),
                },
                onError: {
                  target: 'idle',
                  actions: assign({
                    notice: ({ event }) => toErrorBody(event.error).message,
                  }),
                },
              },
            },
          },
        },
      },
    },

    /** 서버가 소스를 모른다 (서버 재시작 등) → 같은 조건으로 다시 연다 */
    reopening: {
      entry: assign({ reopenCount: ({ context }) => context.reopenCount + 1 }),
      invoke: {
        src: 'openSource',
        input: ({ context: { id, interval, mode } }) => ({
          id,
          interval,
          mode,
        }),
        onDone: {
          target: 'ready',
          actions: assign(({ event }) => freshSet(event.output)),
        },
        onError: {
          target: 'failed',
          actions: assign({ failure: ({ event }) => toErrorBody(event.error) }),
        },
      },
    },

    failed: {},
  },
})
