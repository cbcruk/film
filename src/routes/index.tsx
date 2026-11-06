import { useCallback, useMemo, useRef } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useMachine } from '@xstate/react'
import { fromPromise } from 'xstate'
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
import { FramePreview } from '../components/FramePreview.tsx'
import { ThumbnailGrid } from '../components/ThumbnailGrid.tsx'
import { VideoTable } from '../components/VideoTable.tsx'
import { getHealth } from '../functions/health.ts'
import { listVideos } from '../functions/sources.ts'
import { useElementWidth } from '../hooks/useElementWidth.ts'
import { formatTimecode } from '../lib/timecode.ts'
import type { FrameFormat, ThumbInterval, ThumbMode } from '../lib/types.ts'
import {
  cachedVideos,
  libraryMachine,
  recentVideos,
  visibleVideos,
} from '../machines/library.ts'
import type { Tab as LibraryTab } from '../machines/library.ts'
import { liveSourceMachine } from '../machines/source.live.ts'
import { toErrorBody } from '../machines/source.ts'
import type { SourceContext, SourceEvent } from '../machines/source.ts'

const INTERVALS: ReadonlyArray<ThumbInterval> = [1, 2, 5, 10, 30]

interface Search {
  /** 선택한 영상 ID */
  readonly v?: string
  /** 균등 모드 간격 (초) */
  readonly i: ThumbInterval
  /** 장면 모드 (없으면 균등 분할) */
  readonly m?: 'scene'
}

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

function HomePage() {
  const { health, list } = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const router = useRouter()
  // 탭·검색·정렬·최근·새로고침 (machines/library.ts)
  const [library, sendLibrary] = useMachine(
    libraryMachine.provide({
      actors: { refresh: fromPromise(() => router.invalidate()) },
    }),
  )
  const { tab, query } = library.context
  const refreshing = library.matches('refreshing')
  const refresh = () => sendLibrary({ type: 'REFRESH' })

  // 사용자가 경계를 끌기 전까지는 화면 폭이 바뀔 때마다 오른쪽 창을 2/3로 맞춘다.
  // useElementWidth는 새 폭을 화면에 반영한 뒤 onResize를 부르므로 maxSize도 이미 새 값이다
  const movedPane = useRef(false)
  const placingPane = useRef(false)
  const [surfaceRef, surfaceWidth] = useElementWidth<HTMLDivElement>(
    (width) => {
      if (movedPane.current || width <= 0) return
      placingPane.current = true
      pane.resize(Math.round(width * PANE_DEFAULT_SHARE))
      placingPane.current = false
    },
  )
  const [listRef, listWidth] = useElementWidth<HTMLDivElement>()
  const isMeasured = surfaceWidth > 0
  const isSingleSurface = isMeasured && surfaceWidth < SINGLE_SURFACE_BELOW
  const isStacked = listWidth > 0 && listWidth < STACK_ROWS_BELOW

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

  const videos = list.ok ? list.value.videos : []
  const visible = useMemo(
    () => visibleVideos(library.context, videos),
    [library.context, videos],
  )

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
        onOpened={(id) => {
          sendLibrary({ type: 'OPENED', id })
          // 열기에 성공하면 서버 캐시에 meta.json이 생긴다 → 목록의 "썸네일 있음"을 다시 읽는다
          if (videos.find((v) => v.id === id)?.cached === false)
            void router.invalidate()
        }}
        onClose={closeVideo}
      />
    )

  const tabs: ReadonlyArray<{
    value: LibraryTab
    label: string
    count: number
  }> = [
    { value: 'all', label: '전체', count: videos.length },
    {
      value: 'recent',
      label: '최근',
      count: recentVideos(library.context, videos).length,
    },
    {
      value: 'cached',
      label: '썸네일 있음',
      count: cachedVideos(videos).length,
    },
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
                  onChange={(q) => sendLibrary({ type: 'SEARCH', query: q })}
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
                  onChange={(value) =>
                    sendLibrary({ type: 'TAB', tab: value as LibraryTab })
                  }
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
                    <Button
                      label="전체 보기"
                      onClick={() => sendLibrary({ type: 'TAB', tab: 'all' })}
                    />
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
              sort={library.context.sort}
              onSort={(sort) => sendLibrary({ type: 'SORT', sort })}
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

/** 연 영상 하나. 흐름은 machines/source.ts, 이 컴포넌트는 상태를 그리기만 한다 */
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
  const { id, interval, mode, formats } = props
  const [state, send] = useMachine(
    // 처음 열기에 성공하면 최근 목록에 넣는다 (매 렌더링의 최신 구현이 쓰인다)
    liveSourceMachine.provide({
      actions: { opened: () => props.onOpened(id) },
    }),
    { input: { id, interval, mode, formats } },
  )
  const { context } = state

  const close = (
    <HStack justify="end">
      <Button label="닫기" variant="ghost" size="sm" onClick={props.onClose} />
    </HStack>
  )

  if (state.matches('opening') || state.matches('reopening')) {
    return mode === 'scene' ? (
      <SceneAnalyzing seconds={context.elapsed} />
    ) : (
      <Center height="100%">
        <HStack gap={2} align="center">
          <Spinner />
          <Text color="secondary">
            {state.matches('reopening') ? '다시 여는 중…' : '여는 중…'}
          </Text>
        </HStack>
      </Center>
    )
  }

  if (state.matches('failed') || context.info === undefined) {
    const { code, message } = context.failure ?? {
      code: 'INTERNAL',
      message: '알 수 없는 오류',
    }
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
      context={context}
      send={send}
      finished={state.matches({ ready: { stream: 'finished' } })}
      busy={!state.matches({ ready: { task: 'idle' } })}
      onInterval={props.onInterval}
      onMode={props.onMode}
      onClose={props.onClose}
    />
  )
}

/** 장면 분석은 영상 전체를 읽으므로 경과 시간을 보여준다 (분석 결과는 캐시되어 두 번째부터는 즉시) */
function SceneAnalyzing({ seconds }: { readonly seconds: number }) {
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

function SourceView({
  context,
  send,
  finished,
  busy,
  ...props
}: {
  readonly context: SourceContext
  readonly send: (event: SourceEvent) => void
  /** 썸네일을 다 만들었다 */
  readonly finished: boolean
  /** 구간 세트를 만들거나 전체 세트로 돌아가는 중 */
  readonly busy: boolean
  readonly onInterval: (i: ThumbInterval) => void
  readonly onMode: (mode: ThumbMode) => void
  readonly onClose: () => void
}) {
  const info = context.info!
  const { selected, offset, thumbs, done } = context
  const total = info.times.length

  const selectedThumb = selected === undefined ? undefined : thumbs[selected]
  const base = selected === undefined ? undefined : info.times[selected]
  // 영상 범위 안으로, 밀리초 단위
  const previewT =
    base === undefined
      ? undefined
      : Math.min(
          Math.max(0, Math.round((base + offset) * 1000) / 1000),
          Math.floor(info.duration * 1000 - 1) / 1000,
        )

  const select = useCallback(
    (index: number | undefined) => send({ type: 'SELECT', index }),
    [send],
  )

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
            value={context.mode}
            onChange={(m) => props.onMode(m as ThumbMode)}
            isDisabled={busy}
            label="썸네일 방식"
          >
            <SegmentedControlItem value="even" label="균등" />
            <SegmentedControlItem value="scene" label="장면" />
          </SegmentedControl>
          {context.mode === 'even' && (
            <Selector
              label="간격"
              isLabelHidden
              variant="secondary"
              value={String(context.interval)}
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
              max={Math.max(1, total)}
              value={done}
              variant={finished ? 'success' : 'accent'}
              formatValueLabel={() => (finished ? '완료' : `${done}/${total}`)}
            />
          </VStack>
          {context.mode === 'scene' && info.range === undefined && (
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
                onClick={() => send({ type: 'FULL' })}
                isDisabled={busy}
              />
            </HStack>
          )}
        </HStack>
        {context.notice && <Banner status="error" title={context.notice} />}
      </VStack>

      {previewT !== undefined && (
        <FramePreview
          info={info}
          t={previewT}
          placeholder={
            selectedThumb?.status === 'ready' ? selectedThumb.url : undefined
          }
          format={context.format}
          formats={context.formats}
          onFormat={(format) => send({ type: 'FORMAT', format })}
          onStep={(seconds) => send({ type: 'STEP', seconds })}
          onMore={() => send({ type: 'MORE' })}
          busy={busy}
        />
      )}

      <ThumbnailGrid
        times={info.times}
        thumbs={thumbs}
        aspect={info.width / info.height}
        selected={selected}
        onSelect={select}
        onRetry={(index) => send({ type: 'RETRY', index })}
        retrying={context.retrying}
      />
    </VStack>
  )
}
