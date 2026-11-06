import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { Center } from '@astryxdesign/core/Center'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { Heading } from '@astryxdesign/core/Heading'
import { HStack } from '@astryxdesign/core/HStack'
import { Badge } from '@astryxdesign/core/Badge'
import {
  Layout,
  LayoutContent,
  LayoutHeader,
  LayoutPanel,
} from '@astryxdesign/core/Layout'
import { ResizeHandle, useResizable } from '@astryxdesign/core/Resizable'
import { StackItem } from '@astryxdesign/core/Stack'
import { Tab, TabList } from '@astryxdesign/core/TabList'
import { TextInput } from '@astryxdesign/core/TextInput'
import { ProgressBar } from '@astryxdesign/core/ProgressBar'
import {
  SegmentedControl,
  SegmentedControlItem,
} from '@astryxdesign/core/SegmentedControl'
import { Selector } from '@astryxdesign/core/Selector'
import { Spinner } from '@astryxdesign/core/Spinner'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import { FramePreview, useFrameFormat } from '../components/FramePreview.tsx'
import { ThumbnailGrid } from '../components/ThumbnailGrid.tsx'
import { VideoTable } from '../components/VideoTable.tsx'
import { getHealth } from '../functions/health.ts'
import {
  createSet,
  listVideos,
  openSource,
  retryThumb,
} from '../functions/sources.ts'
import { useElementWidth } from '../hooks/useElementWidth.ts'
import { useRecent } from '../hooks/useRecent.ts'
import { useSourceEvents } from '../hooks/useSourceEvents.ts'
import { isTextEntry } from '../lib/keyboard.ts'
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

/** 이보다 좁으면 목록과 썸네일 창을 나란히 두지 않고, 연 영상이 화면 전체를 쓴다 */
const SINGLE_SURFACE_BELOW = 900
/** 목록이 이보다 좁으면 크기·수정일 열을 이름 아래로 접는다 */
const STACK_ROWS_BELOW = 560
const LIST_MIN_WIDTH = 300
const PANE_MIN_WIDTH = 480
/** 썸네일 창이 처음 차지하는 몫 — 이 앱의 주 작업 공간이다 */
const PANE_DEFAULT_SHARE = 2 / 3

type Tab = 'all' | 'recent' | 'cached'

function HomePage() {
  const { health, list } = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const router = useRouter()
  const [refreshing, setRefreshing] = useState(false)
  const [recent, addRecent] = useRecent()
  const [tab, setTab] = useState<Tab>('all')
  const [query, setQuery] = useState('')

  const [surfaceRef, surfaceWidth] = useElementWidth<HTMLDivElement>()
  const [listRef, listWidth] = useElementWidth<HTMLDivElement>()
  const isMeasured = surfaceWidth > 0
  const isSingleSurface = isMeasured && surfaceWidth < SINGLE_SURFACE_BELOW
  const isStacked = listWidth > 0 && listWidth < STACK_ROWS_BELOW

  // 사용자가 경계를 끌기 전까지는 화면 폭의 2/3로 맞춘다
  const movedPane = useRef(false)
  const placingPane = useRef(false)
  const pane = useResizable({
    defaultSize: '66%',
    minSize: PANE_MIN_WIDTH,
    maxSize: isMeasured
      ? Math.max(PANE_MIN_WIDTH, surfaceWidth - LIST_MIN_WIDTH)
      : undefined,
    onSizeChange: () => {
      if (!placingPane.current) movedPane.current = true
    },
  })
  const { resize: resizePane } = pane
  useLayoutEffect(() => {
    if (movedPane.current || !isMeasured) return
    placingPane.current = true
    resizePane(Math.round(surfaceWidth * PANE_DEFAULT_SHARE))
    placingPane.current = false
  }, [isMeasured, surfaceWidth, resizePane])

  const videos = list.ok ? list.value.videos : []
  const recentVideos = useMemo(() => {
    const byId = new Map(videos.map((v) => [v.id, v]))
    return recent.flatMap((id) => byId.get(id) ?? [])
  }, [videos, recent])
  const cachedVideos = useMemo(() => videos.filter((v) => v.cached), [videos])

  const visible = useMemo(() => {
    const inTab =
      tab === 'recent' ? recentVideos : tab === 'cached' ? cachedVideos : videos
    const q = query.trim().toLowerCase()
    return q === ''
      ? inTab
      : inTab.filter((v) => v.name.toLowerCase().includes(q))
  }, [tab, videos, recentVideos, cachedVideos, query])

  const openVideo = useCallback(
    (v: string) => navigate({ search: (s) => ({ ...s, v }) }),
    [navigate],
  )
  const closeVideo = () => navigate({ search: ({ v: _, ...s }) => s })

  if (health.ffmpeg === null) {
    return (
      <Center height="100%">
        <EmptyState
          headingLevel={1}
          title="ffmpeg를 찾을 수 없습니다"
          description="brew install ffmpeg 로 설치한 뒤 다시 열어 주세요"
        />
      </Center>
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

  const isPaneFullWidth = isSingleSurface && search.v !== undefined

  const source =
    search.v === undefined ? undefined : (
      <SourcePanel
        key={
          search.m === 'scene' ? `${search.v}-scene` : `${search.v}-${search.i}`
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
        onClose={closeVideo}
      />
    )

  const tabs: ReadonlyArray<{ value: Tab; label: string; count: number }> = [
    { value: 'all', label: '전체', count: videos.length },
    { value: 'recent', label: '최근', count: recentVideos.length },
    { value: 'cached', label: '썸네일 있음', count: cachedVideos.length },
  ]

  return (
    <Layout
      ref={surfaceRef}
      height="fill"
      header={
        isPaneFullWidth ? undefined : (
          <LayoutHeader padding={0}>
            <VStack gap={0}>
              <HStack gap={3} align="center" wrap="wrap" padding={4}>
                <StackItem size="fill">
                  <VStack gap={0.5}>
                    <Heading level={1}>film</Heading>
                    <Text type="supporting" maxLines={1}>
                      {list.ok
                        ? `${list.value.dir} · 영상 ${videos.length}개`
                        : health.filmDir}
                    </Text>
                  </VStack>
                </StackItem>
                <TextInput
                  type="search"
                  label="파일명 검색"
                  isLabelHidden
                  placeholder="파일명 검색"
                  value={query}
                  onChange={setQuery}
                  hasClear
                  width={240}
                />
                <Button
                  label={refreshing ? '읽는 중…' : '새로고침'}
                  variant="ghost"
                  onClick={refresh}
                  isLoading={refreshing}
                />
              </HStack>
              <VStack paddingInline={1}>
                <TabList
                  hasDivider
                  value={tab}
                  onChange={(value) => setTab(value as Tab)}
                >
                  {tabs.map((t) => (
                    <Tab
                      key={t.value}
                      value={t.value}
                      label={t.label}
                      endContent={
                        t.count === 0 ? undefined : (
                          <Badge variant="neutral" label={t.count} />
                        )
                      }
                    />
                  ))}
                </TabList>
              </VStack>
            </VStack>
          </LayoutHeader>
        )
      }
      content={
        <LayoutContent ref={listRef} padding={4} label="영상 목록">
          {isPaneFullWidth ? (
            source
          ) : !list.ok ? (
            <VStack gap={3}>
              <Banner
                status="error"
                title={
                  list.error.code === 'LIBRARY_NOT_FOUND'
                    ? '영상 폴더를 찾을 수 없습니다'
                    : list.error.message
                }
                description={
                  list.error.code === 'LIBRARY_NOT_FOUND'
                    ? `.env의 FILM_DIR을 확인하세요 (${health.filmDir})`
                    : undefined
                }
                endContent={<Button label="다시 시도" onClick={refresh} />}
              />
            </VStack>
          ) : visible.length === 0 ? (
            <VStack padding={6}>
              <EmptyState
                title={
                  query.trim() !== ''
                    ? '일치하는 파일이 없습니다'
                    : tab === 'recent'
                      ? '최근 연 영상이 없습니다'
                      : tab === 'cached'
                        ? '썸네일을 만든 영상이 없습니다'
                        : '이 폴더에 영상이 없습니다'
                }
                description={
                  query.trim() !== ''
                    ? `“${query}”`
                    : tab === 'all'
                      ? '.mp4 .webm .mkv .mov 파일을 넣고 새로고침하세요'
                      : undefined
                }
                actions={
                  tab === 'all' ? undefined : (
                    <Button label="전체 보기" onClick={() => setTab('all')} />
                  )
                }
              />
            </VStack>
          ) : (
            <VideoTable
              videos={visible}
              openId={search.v}
              onOpen={openVideo}
              isStacked={isStacked}
            />
          )}
        </LayoutContent>
      }
      end={
        isSingleSurface || source === undefined ? undefined : (
          <>
            <ResizeHandle
              direction="horizontal"
              isReversed
              hasDivider
              pillPlacement="end"
              resizable={pane.props}
              label="썸네일 창 크기 조절"
            />
            <LayoutPanel
              resizable={pane.props}
              padding={5}
              role="complementary"
              label="썸네일"
            >
              {source}
            </LayoutPanel>
          </>
        )
      }
    />
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
  readonly onClose: () => void
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

  const close = (
    <HStack justify="end">
      <Button label="닫기" variant="ghost" size="sm" onClick={props.onClose} />
    </HStack>
  )

  if (state.status === 'loading') {
    return mode === 'scene' ? (
      <SceneAnalyzing />
    ) : (
      <Center height="100%">
        <HStack gap={2} align="center">
          <Spinner />
          <Text color="secondary">여는 중…</Text>
        </HStack>
      </Center>
    )
  }
  if (state.status === 'error') {
    const { code, message } = state.error
    return (
      <VStack gap={3}>
        {close}
        <Banner
          status="error"
          title={
            code === 'FILE_NOT_FOUND'
              ? '파일을 찾을 수 없습니다'
              : code === 'NOT_A_VIDEO'
                ? '지원하지 않는 파일입니다'
                : message
          }
          description={
            code === 'FILE_NOT_FOUND' ? '목록을 새로고침하세요' : undefined
          }
          endContent={
            code === 'FILE_NOT_FOUND' ? (
              <Button label="목록 새로고침" onClick={props.onMissing} />
            ) : undefined
          }
        />
      </VStack>
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
      onClose={props.onClose}
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
    <Center height="100%">
      <VStack gap={2} align="center">
        <Spinner size="lg" />
        <Text>장면 전환을 찾는 중… {seconds > 0 && `${seconds}초`}</Text>
        <Text type="supporting">
          처음 한 번은 영상 전체를 읽습니다 (4분 1080p 기준 수 초)
        </Text>
      </VStack>
    </Center>
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
  readonly onClose: () => void
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
      if (isTextEntry(e.target)) return
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
    <VStack as="section" gap={5}>
      <VStack as="header" gap={3}>
        <HStack gap={3} align="start">
          <StackItem size="fill">
            <VStack gap={1}>
              <Heading level={2} maxLines={1}>
                {info.name}
              </Heading>
              <Text type="supporting" hasTabularNumbers>
                {formatTimecode(info.duration)} · {info.width}×{info.height} ·{' '}
                {info.fps} fps · {info.codec}
              </Text>
            </VStack>
          </StackItem>
          <Button
            label="닫기"
            variant="ghost"
            size="sm"
            onClick={props.onClose}
          />
        </HStack>
        <HStack gap={3} wrap="wrap" align="center">
          <SegmentedControl
            value={props.mode}
            onChange={(m) => props.onMode(m as ThumbMode)}
            isDisabled={busy}
            label="썸네일 방식"
          >
            <SegmentedControlItem value="even" label="균등" />
            <SegmentedControlItem value="scene" label="장면" />
          </SegmentedControl>
          {props.mode === 'even' && (
            <Selector
              label="간격"
              isLabelHidden
              variant="secondary"
              value={String(props.interval)}
              options={INTERVALS.map((i) => ({
                value: String(i),
                label: `${i}초마다`,
              }))}
              onChange={(v) => props.onInterval(Number(v) as ThumbInterval)}
              isDisabled={info.range !== undefined}
            />
          )}
          <VStack width={240}>
            <ProgressBar
              label="썸네일 생성 진행률"
              isLabelHidden
              hasValueLabel
              max={Math.max(1, events.total)}
              value={events.done}
              variant={events.finished ? 'success' : 'accent'}
              formatValueLabel={() =>
                events.finished ? '완료' : `${events.done}/${events.total}`
              }
            />
          </VStack>
          {props.mode === 'scene' && info.range === undefined && (
            <Text type="supporting" data-scene-note>
              {info.mode === 'even'
                ? '장면 전환을 찾지 못해 균등 분할로 보여줍니다'
                : `장면 전환 ${info.times.length}곳`}
            </Text>
          )}
          {info.range && (
            <HStack gap={2} align="center" data-range>
              <Text type="supporting" hasTabularNumbers>
                구간 {formatTimecode(info.range.from)} ~{' '}
                {formatTimecode(info.range.to)}
              </Text>
              <Button
                size="sm"
                label="전체 보기"
                onClick={backToFull}
                isDisabled={busy}
              />
            </HStack>
          )}
        </HStack>
        {error && <Banner status="error" title={error} />}
      </VStack>

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
    </VStack>
  )
}
