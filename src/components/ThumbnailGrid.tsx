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
  // 포커스 위치와 상관없이 ←/→로 이동한다 (Safari는 버튼을 클릭해도 포커스를 주지 않는다)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
      // Shift+←/→는 미리보기의 ±1초 이동
      if (step === 0 || e.shiftKey || e.altKey || e.metaKey || e.ctrlKey) return
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
          <li key={i} className="card-cell">
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
            {thumb?.status === 'error' && (
              // 카드 버튼 안에 버튼을 넣을 수 없어 겹쳐서 배치한다
              <button
                type="button"
                className="card-retry"
                onClick={() => onRetry(i)}
                disabled={retrying.has(i)}
              >
                {retrying.has(i) ? '다시 만드는 중…' : '재시도'}
              </button>
            )}
          </li>
        )
      })}
    </ol>
  )
}
