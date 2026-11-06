import { AspectRatio } from '@astryxdesign/core/AspectRatio'
import { Button } from '@astryxdesign/core/Button'
import { Center } from '@astryxdesign/core/Center'
import { Grid } from '@astryxdesign/core/Grid'
import { HStack } from '@astryxdesign/core/HStack'
import { SelectableCard } from '@astryxdesign/core/SelectableCard'
import { Skeleton } from '@astryxdesign/core/Skeleton'
import { Text } from '@astryxdesign/core/Text'
import { Token } from '@astryxdesign/core/Token'
import { VStack } from '@astryxdesign/core/VStack'
import type { ThumbState } from '../machines/source.ts'
import { formatTimecode } from '../lib/timecode.ts'

/** 이미지 모서리 (AspectRatio가 overflow: clip이라 그대로 잘린다) */
const ROUNDED = { borderRadius: 'var(--radius-element)' }
/**
 * 시간 표시 줄: 이미지 위에 겹치되 클릭을 가로채지 않는다.
 * AspectRatio는 감싸는 칸만 absolute라, 겹칠 줄은 직접 띄운다
 */
/** 밝은 이미지 위에서도 읽히도록 기본(반투명) 대신 불투명 배경 */
const ON_IMAGE = { backgroundColor: 'var(--color-background-popover)' }
const OVERLAY = {
  position: 'absolute',
  inset: 0,
  pointerEvents: 'none',
} as const

interface Props {
  readonly times: ReadonlyArray<number>
  readonly thumbs: ReadonlyArray<ThumbState | undefined>
  /** 카드 비율 (영상 표시 크기) — 생성 전에도 자리를 고정한다 */
  readonly aspect: number
  readonly selected: number | undefined
  readonly onSelect: (index: number) => void
  /** 실패한 칸 다시 만들기 */
  readonly onRetry: (index: number) => void
  /** 재시도 중인 칸 */
  readonly retrying: ReadonlySet<number>
}

export function ThumbnailGrid({
  times,
  thumbs,
  aspect,
  selected,
  onSelect,
  onRetry,
  retrying,
}: Props) {
  return (
    <Grid columns={{ minWidth: 200, max: 12 }} gap={3}>
      {times.map((t, i) => {
        const thumb = thumbs[i]
        const time = formatTimecode(t)
        return (
          <SelectableCard
            key={i}
            id={`thumb-${i}`}
            label={`${time} 썸네일`}
            isSelected={i === selected}
            onChange={() => onSelect(i)}
            variant="transparent"
            padding={1}
          >
            <AspectRatio ratio={aspect} fit="cover" style={ROUNDED}>
              {thumb === undefined ? (
                <Skeleton index={i % 12} radius="none" />
              ) : thumb.status === 'ready' ? (
                <img src={thumb.url} alt="" loading="lazy" draggable={false} />
              ) : (
                <Center padding={2}>
                  <VStack gap={1} align="center">
                    <Text type="supporting" maxLines={2}>
                      추출 실패: {thumb.message}
                    </Text>
                    <Button
                      size="sm"
                      label={retrying.has(i) ? '다시 만드는 중…' : '재시도'}
                      onClick={() => onRetry(i)}
                      isLoading={retrying.has(i)}
                    />
                  </VStack>
                </Center>
              )}
              {/* 이미지 위 오른쪽 위에 겹친다. 클릭은 아래(카드·재시도 버튼)로 통과 */}
              <HStack
                justify="end"
                align="start"
                padding={1}
                style={OVERLAY}
                data-time={time}
              >
                <Token size="sm" label={time} style={ON_IMAGE} />
              </HStack>
            </AspectRatio>
          </SelectableCard>
        )
      })}
    </Grid>
  )
}
