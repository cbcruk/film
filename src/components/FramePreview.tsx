import { useEffect, useState } from 'react'
import { formatTimecode, frameFilename, frameUrl } from '../lib/timecode.ts'
import type { FrameFormat, SourceInfo } from '../lib/types.ts'

interface Props {
  readonly info: SourceInfo
  readonly t: number
  /** 원본이 로드되는 동안 확대해서 보여줄 썸네일 */
  readonly placeholder: string | undefined
  readonly format: FrameFormat
  readonly formats: ReadonlyArray<FrameFormat>
  readonly onFormat: (format: FrameFormat) => void
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
}: Props) {
  const src = frameUrl(info.id, info.name, t, format)
  // 어느 URL이 로드·실패했는지로 상태를 정한다 (캐시된 이미지는 onLoad가 바로 올 수 있음)
  const [result, setResult] = useState<{ src: string; ok: boolean }>()
  const status = result?.src !== src ? 'loading' : result.ok ? 'ready' : 'error'

  return (
    <figure className="preview">
      <div
        className="preview-frame"
        style={{ aspectRatio: info.width / info.height }}
      >
        {placeholder && status !== 'ready' && (
          <img
            className="preview-placeholder"
            src={placeholder}
            alt=""
            aria-hidden
          />
        )}
        <img
          key={src}
          className="preview-image"
          src={src}
          alt={`${info.name} ${formatTimecode(t)}`}
          width={info.width}
          height={info.height}
          onLoad={() => setResult({ src, ok: true })}
          onError={() => setResult({ src, ok: false })}
          data-status={status}
        />
        {status === 'loading' && (
          <span className="preview-badge">원본 불러오는 중…</span>
        )}
        {status === 'error' && (
          <span className="preview-badge error">
            원본 프레임을 만들지 못했습니다
          </span>
        )}
      </div>

      <figcaption className="preview-caption">
        <span className="preview-time">{formatTimecode(t)}</span>
        <span className="preview-name">
          {frameFilename(info.name, t, format)} · {info.width}×{info.height}
        </span>
        <span className="formats" role="radiogroup" aria-label="저장 포맷">
          {formats.map((f) => (
            <button
              key={f}
              type="button"
              role="radio"
              aria-checked={f === format}
              onClick={() => onFormat(f)}
            >
              {LABELS[f]}
            </button>
          ))}
        </span>
        <span className="preview-hint">
          이미지를 우클릭해 [이미지를 다른 이름으로 저장]
        </span>
      </figcaption>
    </figure>
  )
}

const STORAGE_KEY = 'film.format'

/** 마지막으로 고른 포맷 (localStorage). 이 ffmpeg가 못 만드는 포맷이면 첫 번째로 */
export const useFrameFormat = (formats: ReadonlyArray<FrameFormat>) => {
  const fallback = formats.includes('png') ? 'png' : (formats[0] ?? 'png')
  const [format, setFormat] = useState<FrameFormat>(fallback)

  // 서버 렌더링과 어긋나지 않도록 마운트 후에 읽는다
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved && formats.includes(saved as FrameFormat))
      setFormat(saved as FrameFormat)
  }, [formats])

  const choose = (next: FrameFormat) => {
    setFormat(next)
    localStorage.setItem(STORAGE_KEY, next)
  }
  return [formats.includes(format) ? format : fallback, choose] as const
}
