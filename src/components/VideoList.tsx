import { useMemo, useState } from 'react'
import type { VideoList as VideoListData } from '../lib/types.ts'

interface Props {
  readonly list: VideoListData
  readonly selectedId: string | undefined
  readonly onSelect: (id: string) => void
  readonly onRefresh: () => void
  readonly refreshing: boolean
}

const formatSize = (bytes: number) =>
  bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(1)} GB`
    : bytes >= 1024 ** 2
      ? `${Math.round(bytes / 1024 ** 2)} MB`
      : `${Math.max(1, Math.round(bytes / 1024))} KB`

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })

export function VideoList({
  list,
  selectedId,
  onSelect,
  onRefresh,
  refreshing,
}: Props) {
  const [query, setQuery] = useState('')
  const videos = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q === ''
      ? list.videos
      : list.videos.filter((v) => v.name.toLowerCase().includes(q))
  }, [list.videos, query])

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <input
          type="search"
          placeholder="파일명 검색"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="파일명 검색"
        />
        <button type="button" onClick={onRefresh} disabled={refreshing}>
          {refreshing ? '읽는 중…' : '새로고침'}
        </button>
      </div>
      <p className="sidebar-dir" title={list.dir}>
        {list.dir} · {list.videos.length}개
      </p>

      {list.videos.length === 0 ? (
        <p className="empty">
          이 폴더에 영상이 없습니다 (.mp4 .webm .mkv .mov)
        </p>
      ) : videos.length === 0 ? (
        <p className="empty">“{query}”와 일치하는 파일이 없습니다</p>
      ) : (
        <ul className="video-list">
          {videos.map((v) => (
            <li key={v.id}>
              <button
                type="button"
                className="video-item"
                aria-current={v.id === selectedId}
                onClick={() => onSelect(v.id)}
              >
                <span className="video-name">{v.name}</span>
                <span className="video-meta">
                  {v.folder && <span>{v.folder}/</span>}
                  <span>{formatSize(v.size)}</span>
                  <span>{formatDate(v.mtime)}</span>
                  {v.cached && <span className="badge">썸네일</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}
