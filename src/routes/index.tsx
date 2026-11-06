import { useEffect, useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { ThumbnailGrid } from '../components/ThumbnailGrid.tsx'
import { VideoList } from '../components/VideoList.tsx'
import { getHealth } from '../functions/health.ts'
import { listVideos, openSource } from '../functions/sources.ts'
import { useSourceEvents } from '../hooks/useSourceEvents.ts'
import { ServerError } from '../lib/server-error.ts'
import { formatTimecode } from '../lib/timecode.ts'
import type { ErrorBody, SourceInfo, ThumbCount } from '../lib/types.ts'

const COUNTS: ReadonlyArray<ThumbCount> = [6, 12, 24, 48]

interface Search {
  /** 선택한 영상 ID */
  readonly v?: string
  /** 썸네일 개수 */
  readonly n: ThumbCount
}

const toErrorBody = (error: unknown): ErrorBody =>
  error instanceof ServerError
    ? { code: error.code, message: error.message }
    : { code: 'INTERNAL', message: String(error) }

export const Route = createFileRoute('/')({
  validateSearch: (search: Record<string, unknown>): Search => {
    const v =
      typeof search.v === 'string' && /^[0-9a-f]{16}$/.test(search.v)
        ? search.v
        : undefined
    const n = COUNTS.find((c) => c === Number(search.n)) ?? 12
    return v === undefined ? { n } : { v, n }
  },
  loader: async () => {
    const health = await getHealth()
    const list = await listVideos().then(
      (value) => ({ ok: true, value }) as const,
      (error: unknown) => ({ ok: false, error: toErrorBody(error) }) as const,
    )
    return { health, list }
  },
  component: HomePage,
})

function HomePage() {
  const { health, list } = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const router = useRouter()
  const [refreshing, setRefreshing] = useState(false)

  if (health.ffmpeg === null) {
    return (
      <main className="notice">
        <h1>ffmpeg를 찾을 수 없습니다</h1>
        <p>
          설치 후 다시 열어 주세요: <code>brew install ffmpeg</code>
        </p>
      </main>
    )
  }

  const refresh = async () => {
    setRefreshing(true)
    try {
      await router.invalidate()
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="layout">
      {list.ok ? (
        <VideoList
          list={list.value}
          selectedId={search.v}
          onSelect={(v) => navigate({ search: (s) => ({ ...s, v }) })}
          onRefresh={refresh}
          refreshing={refreshing}
        />
      ) : (
        <aside className="sidebar">
          <p className="error">
            {list.error.code === 'LIBRARY_NOT_FOUND'
              ? '영상 폴더를 찾을 수 없습니다. .env의 FILM_DIR을 확인하세요.'
              : list.error.message}
          </p>
          <p className="sidebar-dir">{health.filmDir}</p>
          <button type="button" onClick={refresh}>
            다시 시도
          </button>
        </aside>
      )}

      <main className="content">
        {search.v === undefined ? (
          <p className="empty">왼쪽 목록에서 영상을 고르세요</p>
        ) : (
          <SourcePanel
            key={`${search.v}-${search.n}`}
            id={search.v}
            count={search.n}
            onCount={(n) => navigate({ search: (s) => ({ ...s, n }) })}
            onMissing={refresh}
          />
        )}
      </main>
    </div>
  )
}

type OpenState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly info: SourceInfo }
  | { readonly status: 'error'; readonly error: ErrorBody }

function SourcePanel(props: {
  readonly id: string
  readonly count: ThumbCount
  readonly onCount: (n: ThumbCount) => void
  /** 파일이 사라졌을 때 목록을 다시 읽는다 */
  readonly onMissing: () => void
}) {
  const { id, count } = props
  const [state, setState] = useState<OpenState>({ status: 'loading' })
  // 서버가 소스를 잃어버리면(재시작 등) 한 번 다시 연다
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    setState({ status: 'loading' })
    openSource({ data: { id, count } }).then(
      (info) => active && setState({ status: 'ready', info }),
      (error: unknown) =>
        active && setState({ status: 'error', error: toErrorBody(error) }),
    )
    return () => {
      active = false
    }
  }, [id, count, attempt])

  if (state.status === 'loading') return <p className="empty">여는 중…</p>
  if (state.status === 'error') {
    const { code, message } = state.error
    return (
      <div className="notice">
        <p className="error">
          {code === 'FILE_NOT_FOUND'
            ? '파일을 찾을 수 없습니다. 목록을 새로고침하세요.'
            : code === 'NOT_A_VIDEO'
              ? '지원하지 않는 파일입니다.'
              : message}
        </p>
        {code === 'FILE_NOT_FOUND' && (
          <button type="button" onClick={props.onMissing}>
            목록 새로고침
          </button>
        )}
      </div>
    )
  }
  return (
    <SourceView
      info={state.info}
      onCount={props.onCount}
      onLost={() => attempt === 0 && setAttempt(1)}
    />
  )
}

function SourceView(props: {
  readonly info: SourceInfo
  readonly onCount: (n: ThumbCount) => void
  readonly onLost: () => void
}) {
  const { info } = props
  const events = useSourceEvents(info.id, info.setId, info.times.length)
  const [selected, setSelected] = useState<number | undefined>(undefined)

  useEffect(() => {
    if (events.lost) props.onLost()
  }, [events.lost])

  return (
    <section className="source">
      <header className="source-head">
        <h2>{info.name}</h2>
        <p className="source-meta">
          {formatTimecode(info.duration)} · {info.width}×{info.height} ·{' '}
          {info.fps} fps · {info.codec}
        </p>
        <label className="count">
          썸네일
          <select
            value={info.times.length}
            onChange={(e) =>
              props.onCount(Number(e.target.value) as ThumbCount)
            }
          >
            {COUNTS.map((n) => (
              <option key={n} value={n}>
                {n}장
              </option>
            ))}
          </select>
        </label>
        <progress
          max={events.total}
          value={events.done}
          aria-label="썸네일 생성 진행률"
        />
        <span className="progress-text">
          {events.finished ? '완료' : `${events.done}/${events.total}`}
        </span>
      </header>

      <ThumbnailGrid
        times={info.times}
        thumbs={events.thumbs}
        aspect={info.width / info.height}
        selected={selected}
        onSelect={setSelected}
      />
    </section>
  )
}
