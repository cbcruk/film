// 클라이언트 상태 머신 (src/machines). 서버 호출·SSE는 가짜로 바꿔 흐름만 확인한다
import { describe, expect, it } from 'vitest'
import { createActor, fromCallback, fromPromise, waitFor } from 'xstate'
import type { RetryResult, SourceInfo } from '../src/lib/types.ts'
import { frameMachine } from '../src/machines/frame.ts'
import {
  RECENT_LIMIT,
  libraryMachine,
  visibleVideos,
} from '../src/machines/library.ts'
import {
  MAX_REOPEN,
  RANGE_COUNT,
  sourceMachine,
} from '../src/machines/source.ts'
import type { SourceEvent } from '../src/machines/source.ts'

const info = (
  setId: string,
  times: number[],
  extra: Partial<SourceInfo> = {},
): SourceInfo => ({
  id: 'abc',
  name: 'a.mp4',
  setId,
  times,
  mode: 'even',
  duration: 40,
  width: 640,
  height: 360,
  fps: 30,
  codec: 'h264',
  cached: [],
  ...extra,
})

/** 가짜 서버. 호출 기록을 남기고, 응답은 테스트가 정한다 */
const fakeSource = (opts: {
  open?: () => Promise<SourceInfo>
  create?: (input: {
    from: number
    to: number
    count: number
  }) => Promise<SourceInfo>
  retry?: (input: { setId: string; index: number }) => RetryResult
}) => {
  const calls = {
    open: 0,
    create: [] as unknown[],
    streams: [] as string[],
    retries: [] as number[],
    opened: 0,
    revealed: [] as Array<number | undefined>,
  }
  let push: (event: SourceEvent) => void = () => {}
  const machine = sourceMachine.provide({
    actions: {
      opened: () => {
        calls.opened++
      },
      revealSelected: ({ context }) => {
        calls.revealed.push(context.selected)
      },
    },
    actors: {
      openSource: fromPromise(() => {
        calls.open++
        return opts.open?.() ?? Promise.resolve(info('s1', [0, 10, 20, 30]))
      }),
      createSet: fromPromise(({ input }) => {
        calls.create.push(input)
        return (
          opts.create?.(input) ??
          Promise.resolve(
            info('s2', [11, 12], { range: { from: input.from, to: input.to } }),
          )
        )
      }),
      retryThumb: fromCallback(({ input, sendBack }) => {
        calls.retries.push(input.index)
        if (opts.retry) sendBack({ type: 'RETRIED', result: opts.retry(input) })
      }),
      stream: fromCallback(({ input, sendBack }) => {
        calls.streams.push(input.setId)
        push = sendBack
      }),
      ticker: fromCallback(() => {}),
    },
  })
  const actor = createActor(machine, {
    input: { id: 'abc', interval: 10, mode: 'even', formats: ['png', 'jpg'] },
  })
  return { actor, calls, push: (e: SourceEvent) => push(e) }
}

const ready = (actor: ReturnType<typeof fakeSource>['actor']) =>
  waitFor(actor, (s) => s.matches({ ready: { task: 'idle' } }))

describe('source 머신', () => {
  it('열면 세트의 칸 수만큼 빈 썸네일로 시작하고, SSE로 채워져 완료된다', async () => {
    const { actor, push, calls } = fakeSource({})
    actor.start()
    expect(actor.getSnapshot().matches('opening')).toBe(true)
    await ready(actor)
    expect(actor.getSnapshot().context.thumbs).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ])
    expect(actor.getSnapshot().context.format).toBe('png')
    expect(calls.streams).toEqual(['s1'])

    push({
      type: 'RECEIVED',
      thumbs: [{ index: 1, thumb: { status: 'ready', url: '/t1' } }],
      done: 2,
    })
    push({ type: 'RECEIVED', thumbs: [], done: 1 }) // 재연결로 다시 온 작은 값은 무시
    push({ type: 'DONE' })
    const s = actor.getSnapshot()
    expect(s.context.thumbs[1]).toEqual({ status: 'ready', url: '/t1' })
    expect(s.context.done).toBe(2)
    expect(s.matches({ ready: { stream: 'finished' } })).toBe(true)
  })

  it('캐시에 있던 칸은 SSE를 기다리지 않고 바로 채운다', async () => {
    const { actor } = fakeSource({
      open: () => Promise.resolve(info('s1', [0, 10, 20], { cached: [0, 2] })),
    })
    actor.start()
    await ready(actor)
    const { thumbs, done } = actor.getSnapshot().context
    expect(thumbs.map((t) => t?.status)).toEqual(['ready', undefined, 'ready'])
    expect(done).toBe(2)
  })

  it('열기에 실패하면 failed로 가고 오류 코드를 남긴다', async () => {
    const { actor } = fakeSource({
      open: () => Promise.reject({ code: 'FILE_NOT_FOUND', message: '없음' }),
    })
    actor.start()
    await waitFor(actor, (s) => s.matches('failed'))
    expect(actor.getSnapshot().context.failure).toEqual({
      code: 'FILE_NOT_FOUND',
      message: '없음',
    })
  })

  it('선택이 없으면 시점 이동·구간 더 보기를 하지 않는다', async () => {
    const { actor, calls } = fakeSource({})
    actor.start()
    await ready(actor)
    actor.send({ type: 'STEP', seconds: 1 })
    actor.send({ type: 'MORE' })
    expect(actor.getSnapshot().context.offset).toBe(0)
    expect(calls.create).toEqual([])
  })

  it('←/→는 선택을 옮기고 시점을 0으로, 선택이 없으면 첫 칸부터, 끝에서는 멈춘다', async () => {
    const { actor, calls } = fakeSource({})
    actor.start()
    await ready(actor)
    actor.send({ type: 'NAVIGATE', step: 1 })
    expect(actor.getSnapshot().context.selected).toBe(0)
    actor.send({ type: 'STEP', seconds: 1 })
    expect(actor.getSnapshot().context.offset).toBe(1)
    actor.send({ type: 'NAVIGATE', step: 1 })
    expect(actor.getSnapshot().context.selected).toBe(1)
    expect(actor.getSnapshot().context.offset).toBe(0)
    actor.send({ type: 'NAVIGATE', step: 1 })
    actor.send({ type: 'NAVIGATE', step: 1 })
    actor.send({ type: 'NAVIGATE', step: 1 }) // 4칸이므로 3에서 멈춘다
    expect(actor.getSnapshot().context.selected).toBe(3)
    actor.send({ type: 'SELECT', index: 0 })
    actor.send({ type: 'NAVIGATE', step: -1 }) // 처음에서도 멈춘다
    expect(actor.getSnapshot().context.selected).toBe(0)
    expect(calls.revealed).toEqual([0, 1, 2, 3]) // 옮겼을 때만 스크롤
  })

  it('opened는 처음 열 때만 부른다 (다시 열기·전체 보기는 제외)', async () => {
    const { actor, push, calls } = fakeSource({})
    actor.start()
    await ready(actor)
    expect(calls.opened).toBe(1)
    push({ type: 'LOST' })
    await waitFor(actor, () => calls.open === 2)
    await ready(actor)
    actor.send({ type: 'FULL' })
    await waitFor(actor, () => calls.open === 3)
    await ready(actor)
    expect(calls.opened).toBe(1)
  })

  it('선택한 칸의 앞뒤 사이로 새 세트를 만들고, 새 세트의 SSE를 구독한다', async () => {
    const { actor, calls } = fakeSource({})
    actor.start()
    await ready(actor)
    actor.send({ type: 'SELECT', index: 2 })
    actor.send({ type: 'STEP', seconds: 1 })
    expect(actor.getSnapshot().context.offset).toBe(1)

    actor.send({ type: 'MORE' })
    expect(
      actor.getSnapshot().matches({ ready: { task: 'creatingSet' } }),
    ).toBe(true)
    await waitFor(actor, (s) => s.context.info?.setId === 's2')
    expect(calls.create).toEqual([
      { id: 'abc', count: RANGE_COUNT, from: 10, to: 30 },
    ])
    const s = actor.getSnapshot()
    expect(s.context.selected).toBeUndefined()
    expect(s.context.offset).toBe(0)
    expect(s.context.thumbs).toHaveLength(2)
    expect(calls.streams).toEqual(['s1', 's2'])
  })

  it('끝 칸이면 영상 처음·끝까지로 나눈다', async () => {
    const { actor, calls } = fakeSource({})
    actor.start()
    await ready(actor)
    actor.send({ type: 'SELECT', index: 3 })
    actor.send({ type: 'MORE' })
    await waitFor(actor, (s) => s.context.info?.setId === 's2')
    expect(calls.create).toEqual([
      { id: 'abc', count: RANGE_COUNT, from: 20, to: 40 },
    ])
  })

  it('구간 만들기가 실패하면 지금 세트를 그대로 두고 알림만 띄운다', async () => {
    const { actor, calls } = fakeSource({
      create: () =>
        Promise.reject({
          code: 'INVALID_PARAM',
          message: '구간이 너무 짧습니다',
        }),
    })
    actor.start()
    await ready(actor)
    actor.send({ type: 'SELECT', index: 1 })
    actor.send({ type: 'MORE' })
    await waitFor(actor, (s) => s.context.notice !== undefined)
    const s = actor.getSnapshot()
    expect(s.context.notice).toBe('구간이 너무 짧습니다')
    expect(s.context.info?.setId).toBe('s1')
    expect(s.context.selected).toBe(1)
    expect(calls.streams).toEqual(['s1']) // SSE도 끊지 않는다
  })

  it('전체 보기는 처음 조건으로 다시 연다', async () => {
    const { actor, calls } = fakeSource({})
    actor.start()
    await ready(actor)
    actor.send({ type: 'FULL' })
    await waitFor(actor, () => calls.open === 2)
    await ready(actor)
    expect(calls.streams).toEqual(['s1', 's1'])
  })

  it(`서버가 소스를 잃으면 다시 열고, ${MAX_REOPEN}번 넘게 연달아 잃으면 실패로 끝난다`, async () => {
    const { actor, push, calls } = fakeSource({})
    actor.start()
    await ready(actor)
    for (let i = 1; i <= MAX_REOPEN; i++) {
      push({ type: 'LOST' })
      await waitFor(actor, () => calls.open === i + 1)
      await ready(actor)
    }
    push({ type: 'LOST' })
    expect(actor.getSnapshot().matches('failed')).toBe(true)
    expect(calls.open).toBe(MAX_REOPEN + 1)
  })

  it('세트를 끝까지 받으면 다시 열기 횟수를 초기화한다', async () => {
    const { actor, push, calls } = fakeSource({})
    actor.start()
    await ready(actor)
    const lose = async () => {
      const before = calls.open
      push({ type: 'LOST' })
      await waitFor(actor, () => calls.open === before + 1)
      await ready(actor)
    }
    for (let i = 0; i < MAX_REOPEN; i++) await lose()
    push({ type: 'DONE' })
    expect(actor.getSnapshot().context.reopenCount).toBe(0)

    // 다음 세트(전체 보기)에서 다시 끊겨도 처음부터 MAX_REOPEN번 다시 연다
    actor.send({ type: 'FULL' })
    await waitFor(
      actor,
      (s) =>
        s.matches({ ready: { stream: 'streaming' } }) &&
        s.matches({ ready: { task: 'idle' } }),
    )
    for (let i = 0; i < MAX_REOPEN; i++) await lose()
    expect(actor.getSnapshot().matches('failed')).toBe(false)
  })

  it('재시도는 칸마다 따로 하고, 결과를 그 칸에 넣는다', async () => {
    const { actor, calls } = fakeSource({
      retry: ({ setId, index }) => ({
        type: 'thumb',
        setId,
        index,
        t: index * 10,
        url: `/r${index}`,
      }),
    })
    actor.start()
    await ready(actor)
    actor.send({ type: 'RETRY', index: 0 })
    actor.send({ type: 'RETRY', index: 3 })
    const s = actor.getSnapshot()
    expect(calls.retries).toEqual([0, 3])
    expect(s.context.thumbs[0]).toEqual({ status: 'ready', url: '/r0' })
    expect(s.context.thumbs[3]).toEqual({ status: 'ready', url: '/r3' })
    expect(s.context.retrying.size).toBe(0)
    // 끝난 재시도는 정리되어 같은 칸을 다시 재시도할 수 있다
    actor.send({ type: 'RETRY', index: 0 })
    expect(calls.retries).toEqual([0, 3, 0])
  })

  it('그사이 세트가 바뀌었으면 늦게 온 재시도 결과는 버린다', async () => {
    const { actor } = fakeSource({})
    actor.start()
    await ready(actor)
    actor.send({ type: 'RETRY', index: 1 })
    expect(actor.getSnapshot().context.retrying.has(1)).toBe(true)
    actor.send({
      type: 'RETRIED',
      result: { type: 'thumb', setId: 'old', index: 1, t: 10, url: '/x' },
    })
    expect(actor.getSnapshot().context.thumbs[1]).toBeUndefined()
  })

  it('재시도 요청이 실패하면 칸을 풀고 알림을 띄운다', async () => {
    const { actor } = fakeSource({})
    actor.start()
    await ready(actor)
    actor.send({ type: 'RETRY', index: 2 })
    actor.send({ type: 'RETRY_FAILED', index: 2, message: '시간 초과' })
    const s = actor.getSnapshot()
    expect(s.context.retrying.has(2)).toBe(false)
    expect(s.context.notice).toBe('시간 초과')
  })

  it('저장된 포맷은 이 ffmpeg가 만들 수 있을 때만 되살린다', () => {
    const { actor } = fakeSource({})
    actor.start()
    actor.send({ type: 'RESTORED', format: 'webp' }) // formats: png, jpg
    expect(actor.getSnapshot().context.format).toBe('png')
    actor.send({ type: 'RESTORED', format: 'jpg' })
    expect(actor.getSnapshot().context.format).toBe('jpg')
  })

  it('첫 상태는 저장소를 읽지 않는다 (서버 렌더링 HTML과 같아야 한다)', () => {
    const { actor } = fakeSource({})
    expect(actor.getSnapshot().context.format).toBe('png')
  })
})

const videos = [
  {
    id: 'a',
    name: 'b-2.mp4',
    folder: '',
    size: 30,
    mtime: '2026-01-03',
    cached: false,
  },
  {
    id: 'b',
    name: 'a-10.mp4',
    folder: '',
    size: 10,
    mtime: '2026-01-01',
    cached: true,
  },
  {
    id: 'c',
    name: 'a-2.mp4',
    folder: 'x',
    size: 20,
    mtime: '2026-01-02',
    cached: false,
  },
]

describe('library 머신', () => {
  const start = (refresh = () => Promise.resolve()) =>
    createActor(
      libraryMachine.provide({ actors: { refresh: fromPromise(refresh) } }),
    ).start()

  it('탭 → 검색 → 정렬 순으로 목록을 거른다', () => {
    const actor = start()
    const names = () =>
      visibleVideos(actor.getSnapshot().context, videos).map((v) => v.name)
    expect(names()).toEqual(['b-2.mp4', 'a-10.mp4', 'a-2.mp4']) // 서버 순서 그대로
    actor.send({
      type: 'SORT',
      sort: [{ sortKey: 'name', direction: 'ascending' }],
    })
    expect(names()).toEqual(['a-2.mp4', 'a-10.mp4', 'b-2.mp4']) // 숫자는 크기순
    actor.send({
      type: 'SORT',
      sort: [{ sortKey: 'size', direction: 'descending' }],
    })
    expect(names()).toEqual(['b-2.mp4', 'a-2.mp4', 'a-10.mp4'])
    actor.send({ type: 'SEARCH', query: ' A- ' })
    expect(names()).toEqual(['a-2.mp4', 'a-10.mp4'])
    actor.send({ type: 'TAB', tab: 'cached' })
    expect(names()).toEqual(['a-10.mp4'])
  })

  it('최근 탭은 연 순서(최신순)이고, 같은 영상은 한 번만, 최대 개수까지', () => {
    const actor = start()
    actor.send({ type: 'OPENED', id: 'c' })
    actor.send({ type: 'OPENED', id: 'a' })
    actor.send({ type: 'OPENED', id: 'c' })
    actor.send({ type: 'OPENED', id: 'gone' }) // 목록에 없는 ID는 보이지 않는다
    actor.send({ type: 'TAB', tab: 'recent' })
    expect(
      visibleVideos(actor.getSnapshot().context, videos).map((v) => v.id),
    ).toEqual(['c', 'a'])
    for (let i = 0; i < 20; i++) actor.send({ type: 'OPENED', id: `v${i}` })
    expect(actor.getSnapshot().context.recent).toHaveLength(RECENT_LIMIT)
  })

  it('저장된 최근 기록은 시작 후 RESTORED로 들어온다', () => {
    const actor = createActor(libraryMachine)
    expect(actor.getSnapshot().context.recent).toEqual([])
    actor.start()
    actor.send({ type: 'RESTORED', recent: ['b'] })
    actor.send({ type: 'TAB', tab: 'recent' })
    expect(
      visibleVideos(actor.getSnapshot().context, videos).map((v) => v.id),
    ).toEqual(['b'])
  })

  it('새로고침 중에는 refreshing, 끝나면(실패해도) idle', async () => {
    let finish: () => void = () => {}
    const actor = start(() => new Promise<void>((r) => (finish = r)))
    actor.send({ type: 'REFRESH' })
    expect(actor.getSnapshot().matches('refreshing')).toBe(true)
    finish()
    await waitFor(actor, (s) => s.matches('idle'))

    const failing = start(() => Promise.reject(new Error('x')))
    failing.send({ type: 'REFRESH' })
    await waitFor(failing, (s) => s.matches('idle'))
  })
})

describe('frame 머신', () => {
  it('불러오는 중에서 성공하면 ready, 실패하면 failed', () => {
    const loaded = createActor(frameMachine).start()
    expect(loaded.getSnapshot().matches('loading')).toBe(true)
    loaded.send({ type: 'LOADED' })
    expect(loaded.getSnapshot().matches('ready')).toBe(true)
    loaded.send({ type: 'FAILED' }) // 끝난 뒤의 결과는 무시
    expect(loaded.getSnapshot().matches('ready')).toBe(true)

    const failed = createActor(frameMachine).start()
    failed.send({ type: 'FAILED' })
    expect(failed.getSnapshot().matches('failed')).toBe(true)
  })
})
