import { useEffect } from 'react'
import type { ThumbState } from '../hooks/useSourceEvents.ts'
import { formatTimecode } from '../lib/timecode.ts'

interface Props {
  readonly times: ReadonlyArray<number>
  readonly thumbs: ReadonlyArray<ThumbState | undefined>
  /** 카드 비율 (영상 표시 크기) — 생성 전에도 자리를 고정한다 */
  readonly aspect: number
  readonly selected: number | undefined
  readonly onSelect: (index: number) => void
}

export function ThumbnailGrid({
  times,
  thumbs,
  aspect,
  selected,
  onSelect,
}: Props) {
  // 포커스 위치와 상관없이 ←/→로 이동한다 (Safari는 버튼을 클릭해도 포커스를 주지 않는다)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
      if (step === 0 || e.altKey || e.metaKey || e.ctrlKey) return
      const target = e.target as HTMLElement | null
      if (target?.closest('input, select, textarea')) return
      e.preventDefault()
      const next = selected === undefined ? 0 : selected + step
      if (next >= 0 && next < times.length) {
        onSelect(next)
        document
          .getElementById(`thumb-${next}`)
          ?.scrollIntoView({ block: 'nearest' })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selected, times.length, onSelect])

  return (
    <ol className="grid" aria-label="썸네일">
      {times.map((t, i) => {
        const thumb = thumbs[i]
        return (
          <li key={i}>
            <button
              id={`thumb-${i}`}
              type="button"
              className="card"
              aria-pressed={i === selected}
              onClick={() => onSelect(i)}
              title={thumb?.status === 'error' ? thumb.message : undefined}
            >
              <span className="card-image" style={{ aspectRatio: aspect }}>
                {thumb === undefined ? (
                  <span className="skeleton" aria-label="생성 중" />
                ) : thumb.status === 'ready' ? (
                  <img
                    src={thumb.url}
                    alt=""
                    loading="lazy"
                    draggable={false}
                  />
                ) : (
                  <span className="card-error">⚠ 추출 실패</span>
                )}
              </span>
              <span className="card-time">{formatTimecode(t)}</span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}
