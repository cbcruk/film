/**
 * 영상 목록 화면: 탭·검색·정렬·최근 연 영상·새로고침.
 *
 *   idle ─REFRESH─▶ refreshing ─(끝나면)─▶ idle
 *
 * 탭·검색·정렬·최근 기록은 어느 상태에서든 바꿀 수 있다.
 * 연 영상(v)·간격(i)·방식(m)은 공유·뒤로 가기를 위해 URL에 있다 (여기 없음).
 */
import { assign, fromCallback, fromPromise, setup } from 'xstate'
import type { VideoList } from '../lib/types.ts'

type Video = VideoList['videos'][number]

export type Tab = 'all' | 'recent' | 'cached'
export type SortKey = 'name' | 'size' | 'mtime'
export type Sort = ReadonlyArray<{
  readonly sortKey: SortKey
  readonly direction: 'ascending' | 'descending'
}>

export interface LibraryContext {
  readonly tab: Tab
  readonly query: string
  /** 비어 있으면 서버 순서(최근 수정순) */
  readonly sort: Sort
  /** 최근 연 영상 ID (최신순) */
  readonly recent: ReadonlyArray<string>
}

export type LibraryEvent =
  | { type: 'TAB'; tab: Tab }
  | { type: 'SEARCH'; query: string }
  | { type: 'SORT'; sort: Sort }
  /** 영상을 열었다 → 최근 목록 맨 앞으로 */
  | { type: 'OPENED'; id: string }
  | { type: 'REFRESH' }
  /** 이 브라우저에 저장된 최근 기록을 읽었다 */
  | { type: 'RESTORED'; recent: ReadonlyArray<string> }

const RECENT_KEY = 'film.recent'
export const RECENT_LIMIT = 10

const readRecent = (): ReadonlyArray<string> => {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(value)
      ? value.filter((v): v is string => typeof v === 'string')
      : []
  } catch {
    return []
  }
}

export const libraryMachine = setup({
  types: {
    context: {} as LibraryContext,
    events: {} as LibraryEvent,
  },
  actors: {
    /** 목록을 서버에서 다시 읽는다. 구현은 화면이 넣는다 (router.invalidate) */
    refresh: fromPromise<void>(() =>
      Promise.reject(new Error('refresh 구현이 없습니다')),
    ),
    /**
     * 저장된 최근 기록을 읽어 RESTORED로 보낸다.
     * 머신이 시작된 뒤(화면이 서버 HTML과 맞춰진 뒤)에 실행되어야 해서 entry가 아닌 작업으로 둔다
     */
    restoreRecent: fromCallback<LibraryEvent>(({ sendBack }) => {
      sendBack({ type: 'RESTORED', recent: readRecent() })
    }),
  },
  actions: {
    saveRecent: ({ context }) => {
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(context.recent))
      } catch {
        // 저장 공간 문제 등은 무시 (편의 기능)
      }
    },
  },
}).createMachine({
  id: 'library',
  context: { tab: 'all', query: '', sort: [], recent: [] },
  invoke: { src: 'restoreRecent' },
  on: {
    RESTORED: { actions: assign({ recent: ({ event }) => event.recent }) },
    TAB: { actions: assign({ tab: ({ event }) => event.tab }) },
    SEARCH: { actions: assign({ query: ({ event }) => event.query }) },
    SORT: { actions: assign({ sort: ({ event }) => event.sort }) },
    OPENED: {
      actions: [
        assign({
          recent: ({ context, event }) =>
            [event.id, ...context.recent.filter((v) => v !== event.id)].slice(
              0,
              RECENT_LIMIT,
            ),
        }),
        'saveRecent',
      ],
    },
  },
  initial: 'idle',
  states: {
    idle: {
      on: { REFRESH: 'refreshing' },
    },
    refreshing: {
      invoke: {
        src: 'refresh',
        // 실패해도 목록 화면이 오류를 보여주므로 여기서는 돌아가기만 한다
        onDone: 'idle',
        onError: 'idle',
      },
    },
  },
})

// ── 화면에 보여줄 목록 (context에서 계산) ──

const compare = (a: Video, b: Video, key: SortKey) =>
  key === 'size'
    ? a.size - b.size
    : key === 'mtime'
      ? a.mtime.localeCompare(b.mtime)
      : a.name.localeCompare(b.name, 'ko', { numeric: true })

/** 지금 목록에 있는 최근 영상만 (삭제·변경된 파일은 ID가 달라져 빠진다) */
export const recentVideos = (
  context: LibraryContext,
  videos: ReadonlyArray<Video>,
) => {
  const byId = new Map(videos.map((v) => [v.id, v]))
  return context.recent.flatMap((id) => byId.get(id) ?? [])
}

export const cachedVideos = (videos: ReadonlyArray<Video>) =>
  videos.filter((v) => v.cached)

/** 탭 → 검색 → 정렬 순으로 거른 목록 */
export const visibleVideos = (
  context: LibraryContext,
  videos: ReadonlyArray<Video>,
) => {
  const inTab =
    context.tab === 'recent'
      ? recentVideos(context, videos)
      : context.tab === 'cached'
        ? cachedVideos(videos)
        : videos
  const q = context.query.trim().toLowerCase()
  const found =
    q === '' ? inTab : inTab.filter((v) => v.name.toLowerCase().includes(q))
  const [first] = context.sort
  if (first === undefined) return found
  const sign = first.direction === 'ascending' ? 1 : -1
  return [...found].sort((a, b) => sign * compare(a, b, first.sortKey))
}
