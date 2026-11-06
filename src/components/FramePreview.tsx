import { useLayoutEffect } from 'react'
import { useMachine } from '@xstate/react'
import { AspectRatio } from '@astryxdesign/core/AspectRatio'
import { Button } from '@astryxdesign/core/Button'
import { ButtonGroup } from '@astryxdesign/core/ButtonGroup'
import { Center } from '@astryxdesign/core/Center'
import { HStack } from '@astryxdesign/core/HStack'
import {
  SegmentedControl,
  SegmentedControlItem,
} from '@astryxdesign/core/SegmentedControl'
import { Spinner } from '@astryxdesign/core/Spinner'
import { StatusDot } from '@astryxdesign/core/StatusDot'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import { formatTimecode, frameFilename, frameUrl } from '../lib/timecode.ts'
import type { FrameFormat, SourceInfo } from '../lib/types.ts'
import { frameMachine } from '../machines/frame.ts'

interface Props {
  readonly info: SourceInfo
  readonly t: number
  /** 원본이 로드되는 동안 확대해서 보여줄 썸네일 */
  readonly placeholder: string | undefined
  readonly format: FrameFormat
  readonly formats: ReadonlyArray<FrameFormat>
  readonly onFormat: (format: FrameFormat) => void
  /** 미리보기 시점을 seconds만큼 옮긴다 (±1프레임·±1초) */
  readonly onStep: (seconds: number) => void
  /** 이 시점 앞뒤 썸네일 사이를 다시 나눈다. 없으면 버튼을 숨긴다 */
  readonly onMore: (() => void) | undefined
  readonly busy: boolean
}

const LABELS: Record<FrameFormat, string> = {
  png: 'PNG',
  jpg: 'JPEG',
  webp: 'WebP',
}

/**
 * 원본 해상도 프레임. 이 <img>가 곧 저장 대상이다 —
 * 축소본이나 canvas 재인코딩 없이 서버가 만든 이미지를 그대로 보여준다 (F5).
 */
export function FramePreview({
  info,
  t,
  placeholder,
  format,
  formats,
  onFormat,
  onStep,
  onMore,
  busy,
}: Props) {
  const frame = 1 / (info.fps > 0 ? info.fps : 30)
  const aspect = info.width / info.height
  const src = frameUrl(info.id, info.name, t, format)
  // 로딩 상태는 machines/frame.ts. 주소가 바뀌면 그림을 그리기 전에 알린다
  const [frameState, sendFrame] = useMachine(frameMachine, { input: { src } })
  useLayoutEffect(() => sendFrame({ type: 'SHOW', src }), [src, sendFrame])
  const status = frameState.matches('ready')
    ? 'ready'
    : frameState.matches('failed')
      ? 'error'
      : 'loading'

  return (
    <VStack as="figure" gap={3}>
      {/* 화면 높이의 62%를 넘지 않게 축소해서 보여줄 뿐, 실제 이미지는 원본 크기 */}
      <Center>
        <VStack width={`min(100%, calc(62vh * ${aspect}))`}>
          <AspectRatio ratio={aspect} fit="contain">
            {placeholder && status !== 'ready' && (
              <img src={placeholder} alt="" aria-hidden />
            )}
            <img
              key={src}
              src={src}
              alt={`${info.name} ${formatTimecode(t)}`}
              width={info.width}
              height={info.height}
              onLoad={() => sendFrame({ type: 'LOADED', src })}
              onError={() => sendFrame({ type: 'FAILED', src })}
              data-preview={status}
              // 로드 전에는 아래 썸네일이 보이도록 감춘다
              style={{ opacity: status === 'ready' ? 1 : 0 }}
            />
          </AspectRatio>
        </VStack>
      </Center>

      <HStack gap={3} wrap="wrap" align="center" justify="between">
        <ButtonGroup label="시점 이동">
          <Button label="−1초" tooltip="Shift+←" onClick={() => onStep(-1)} />
          <Button label="−1프레임" tooltip="," onClick={() => onStep(-frame)} />
          <Button label="+1프레임" tooltip="." onClick={() => onStep(frame)} />
          <Button label="+1초" tooltip="Shift+→" onClick={() => onStep(1)} />
        </ButtonGroup>
        {onMore && (
          <Button
            variant="primary"
            label={busy ? '만드는 중…' : '이 구간 더 보기'}
            onClick={onMore}
            isLoading={busy}
            data-more
          />
        )}
      </HStack>

      <VStack as="figcaption" gap={1}>
        <HStack gap={3} wrap="wrap" align="center">
          <Text type="large" weight="semibold" hasTabularNumbers>
            {formatTimecode(t)}
          </Text>
          <SegmentedControl
            size="sm"
            value={format}
            onChange={(f) => onFormat(f as FrameFormat)}
            label="저장 포맷"
          >
            {formats.map((f) => (
              <SegmentedControlItem key={f} value={f} label={LABELS[f]} />
            ))}
          </SegmentedControl>
          {status === 'loading' && (
            <HStack gap={1} align="center">
              <Spinner size="sm" />
              <Text type="supporting">원본 불러오는 중…</Text>
            </HStack>
          )}
          {status === 'error' && (
            <HStack gap={1} align="center">
              <StatusDot variant="error" label="오류" />
              <Text type="supporting">원본 프레임을 만들지 못했습니다</Text>
            </HStack>
          )}
        </HStack>
        <Text type="supporting">
          {frameFilename(info.name, t, format)} · {info.width}×{info.height} ·
          이미지를 우클릭해 [이미지를 다른 이름으로 저장]
        </Text>
      </VStack>
    </VStack>
  )
}
