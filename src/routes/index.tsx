import { useCallback, useEffect, useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { FramePreview, useFrameFormat } from '../components/FramePreview.tsx'
import { ThumbnailGrid } from '../components/ThumbnailGrid.tsx'
import { VideoList } from '../components/VideoList.tsx'
import { getHealth } from '../functions/health.ts'
import {
  createSet,
  listVideos,
  openSource,
  retryThumb,
} from '../functions/sources.ts'
import { useRecent } from '../hooks/useRecent.ts'
import { useSourceEvents } from '../hooks/useSourceEvents.ts'
import { ServerError } from '../lib/server-error.ts'
import { formatTimecode } from '../lib/timecode.ts'
import type {
  ErrorBody,
  FrameFormat,
  SourceInfo,
  ThumbCount,
  ThumbInterval,
  ThumbMode,
} from '../lib/types.ts'

const INTERVALS: ReadonlyArray<ThumbInterval> = [1, 2, 5, 10, 30]

/** [이 구간 더 보기]로 나누는 장수 */
const RANGE_COUNT: ThumbCount = 12

interface Search {
  /** 선택한 영상 ID */
  readonly v?: string
  /** 균등 모드 간격 (초) */
  readonly i: ThumbInterval
  /** 장면 모드 (없으면 균등 분할) */
  readonly m?: 'scene'
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
    const i = INTERVALS.find((c) => c === Number(search.i)) ?? 10
    return {
      i,
      ...(v === undefined ? {} : { v }),
      ...(search.m === 'scene' ? { m: 'scene' as const } : {}),
    }
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
  const [recent, addRecent] = useRecent()

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
          recent={recent}
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
            key={
              search.m === 'scene'
                ? `${search.v}-scene`
                : `${search.v}-${search.i}`
            }
            id={search.v}
            interval={search.i}
            mode={search.m ?? 'even'}
            formats={health.formats}
            onInterval={(i) => navigate({ search: (s) => ({ ...s, i }) })}
            onMode={(mode) =>
              navigate({
                search: ({ m: _, ...s }) =>
                  mode === 'scene' ? { ...s, m: 'scene' as const } : s,
              })
            }
            onMissing={refresh}
            onOpened={addRecent}
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
  readonly interval: ThumbInterval
  readonly mode: ThumbMode
  readonly formats: ReadonlyArray<FrameFormat>
  readonly onInterval: (i: ThumbInterval) => void
  readonly onMode: (mode: ThumbMode) => void
  /** 파일이 사라졌을 때 목록을 다시 읽는다 */
  readonly onMissing: () => void
  /** 열기에 성공하면 최근 목록에 넣는다 */
  readonly onOpened: (id: string) => void
}) {
  const { id, interval, mode } = props
  const [state, setState] = useState<OpenState>({ status: 'loading' })
  // 서버가 소스를 잃어버리면(재시작 등) 한 번 다시 연다
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    setState({ status: 'loading' })
    openSource({ data: { id, interval, mode } }).then(
      (info) => {
        if (!active) return
        setState({ status: 'ready', info })
        props.onOpened(info.id)
      },
      (error: unknown) =>
        active && setState({ status: 'error', error: toErrorBody(error) }),
    )
    return () => {
      active = false
    }
  }, [id, interval, mode, attempt])

  if (state.status === 'loading') {
    return mode === 'scene' ? (
      <SceneAnalyzing />
    ) : (
      <p className="empty">여는 중…</p>
    )
  }
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
      interval={interval}
      mode={mode}
      formats={props.formats}
      onInterval={props.onInterval}
      onMode={props.onMode}
      onLost={() => attempt === 0 && setAttempt(1)}
    />
  )
}

/** 장면 분석은 영상 전체를 읽으므로 경과 시간을 보여준다 (분석 결과는 캐시되어 두 번째부터는 즉시) */
function SceneAnalyzing() {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => clearInterval(timer)
  }, [])
  return (
    <p className="empty">
      장면 전환을 찾는 중… {seconds > 0 && `${seconds}초`}
      <br />
      처음 한 번은 영상 전체를 읽습니다 (4분 1080p 기준 수 초)
    </p>
  )
}

function SourceView(props: {
  readonly info: SourceInfo
  /** 요청한 간격·방식 */
  readonly interval: ThumbInterval
  readonly mode: ThumbMode
  readonly formats: ReadonlyArray<FrameFormat>
  readonly onInterval: (i: ThumbInterval) => void
  readonly onMode: (mode: ThumbMode) => void
  readonly onLost: () => void
}) {
  // 구간 재생성·전체 보기로 세트가 바뀐다. 처음 연 세트는 props.info
  const [info, setInfo] = useState(props.info)
  const events = useSourceEvents(info.id, info.setId, info.times.length)
  const [selected, setSelected] = useState<number | undefined>(undefined)
  // 선택한 썸네일 기준 ±이동량 (초)
  const [offset, setOffset] = useState(0)
  const [format, setFormat] = useFrameFormat(props.formats)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [retrying, setRetrying] = useState<ReadonlySet<number>>(new Set())

  const selectedThumb =
    selected === undefined ? undefined : events.thumbs[selected]
  const base = selected === undefined ? undefined : info.times[selected]
  // 영상 범위 안으로, 밀리초 단위
  const previewT =
    base === undefined
      ? undefined
      : Math.min(
          Math.max(0, Math.round((base + offset) * 1000) / 1000),
          Math.floor(info.duration * 1000 - 1) / 1000,
        )

  const select = useCallback((index: number | undefined) => {
    setSelected(index)
    setOffset(0)
  }, [])

  useEffect(() => {
    if (events.lost) props.onLost()
  }, [events.lost])

  const run = async (task: () => Promise<SourceInfo>) => {
    setBusy(true)
    setError(undefined)
    try {
      const next = await task()
      setInfo(next)
      select(undefined)
    } catch (e) {
      setError(toErrorBody(e).message)
    } finally {
      setBusy(false)
    }
  }

  // 선택한 칸의 앞뒤 썸네일 사이 (끝 칸이면 세트 구간·영상 끝까지)
  const more =
    selected === undefined
      ? undefined
      : () => {
          const from = info.times[selected - 1] ?? info.range?.from ?? 0
          const to = info.times[selected + 1] ?? info.range?.to ?? info.duration
          void run(() =>
            createSet({
              data: {
                id: info.id,
                count: RANGE_COUNT,
                from,
                to,
              },
            }),
          )
        }

  const backToFull = () =>
    run(() =>
      openSource({
        data: { id: info.id, interval: props.interval, mode: props.mode },
      }),
    )

  const retry = async (index: number) => {
    setRetrying((r) => new Set(r).add(index))
    try {
      events.apply(
        await retryThumb({ data: { id: info.id, setId: info.setId, index } }),
      )
    } catch (e) {
      setError(toErrorBody(e).message)
    } finally {
      setRetrying((r) => {
        const next = new Set(r)
        next.delete(index)
        return next
      })
    }
  }

  // ,/. = ±1프레임, Shift+←/→ = ±1초 (선택한 썸네일이 있을 때)
  useEffect(() => {
    if (selected === undefined) return
    const frame = 1 / (info.fps > 0 ? info.fps : 30)
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target?.closest('input, select, textarea')) return
      if (e.altKey || e.metaKey || e.ctrlKey) return
      const step =
        e.key === ','
          ? -frame
          : e.key === '.'
            ? frame
            : e.shiftKey && e.key === 'ArrowLeft'
              ? -1
              : e.shiftKey && e.key === 'ArrowRight'
                ? 1
                : 0
      if (step === 0) return
      e.preventDefault()
      setOffset((o) => o + step)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selected, info.fps])

  return (
    <section className="source">
      <header className="source-head">
        <h2>{info.name}</h2>
        <p className="source-meta">
          {formatTimecode(info.duration)} · {info.width}×{info.height} ·{' '}
          {info.fps} fps · {info.codec}
        </p>
        <span className="modes" role="radiogroup" aria-label="썸네일 방식">
          {(['even', 'scene'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={props.mode === m}
              onClick={() => props.onMode(m)}
              disabled={busy}
            >
              {m === 'even' ? '균등' : '장면'}
            </button>
          ))}
        </span>
        {props.mode === 'even' && (
          <label className="count">
            간격
            <select
              value={props.interval}
              onChange={(e) =>
                props.onInterval(Number(e.target.value) as ThumbInterval)
              }
              disabled={info.range !== undefined}
            >
              {INTERVALS.map((i) => (
                <option key={i} value={i}>
                  {i}초마다
                </option>
              ))}
            </select>
          </label>
        )}
        <progress
          max={events.total}
          value={events.done}
          aria-label="썸네일 생성 진행률"
        />
        <span className="progress-text">
          {events.finished ? '완료' : `${events.done}/${events.total}`}
        </span>
        {props.mode === 'scene' && info.range === undefined && (
          <span className="scene-note">
            {info.mode === 'even'
              ? '장면 전환을 찾지 못해 균등 분할로 보여줍니다'
              : `장면 전환 ${info.times.length}곳`}
          </span>
        )}
        {info.range && (
          <span className="range">
            구간 {formatTimecode(info.range.from)} ~{' '}
            {formatTimecode(info.range.to)}
            <button type="button" onClick={backToFull} disabled={busy}>
              전체 보기
            </button>
          </span>
        )}
        {error && <span className="error">{error}</span>}
      </header>

      {previewT !== undefined && (
        <FramePreview
          info={info}
          t={previewT}
          placeholder={
            selectedThumb?.status === 'ready' ? selectedThumb.url : undefined
          }
          format={format}
          formats={props.formats}
          onFormat={setFormat}
          onStep={(seconds) => setOffset((o) => o + seconds)}
          onMore={more}
          busy={busy}
        />
      )}

      <ThumbnailGrid
        times={info.times}
        thumbs={events.thumbs}
        aspect={info.width / info.height}
        selected={selected}
        onSelect={select}
        onRetry={(index) => void retry(index)}
        retrying={retrying}
      />
    </section>
  )
}
