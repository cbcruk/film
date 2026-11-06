import { useMemo, useState } from 'react'
import type { VideoList as VideoListData } from '../lib/types.ts'

interface Props {
  readonly list: VideoListData
  readonly selectedId: string | undefined
  readonly onSelect: (id: string) => void
  readonly onRefresh: () => void
  readonly refreshing: boolean
  /** 최근 연 영상 ID (최신순) */
  readonly recent: ReadonlyArray<string>
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
  recent,
}: Props) {
  const [query, setQuery] = useState('')
  const videos = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q === ''
      ? list.videos
      : list.videos.filter((v) => v.name.toLowerCase().includes(q))
  }, [list.videos, query])

  // 지금 목록에 있는 것만 (삭제·변경된 파일은 ID가 달라져 빠진다)
  const recentVideos = useMemo(() => {
    const byId = new Map(list.videos.map((v) => [v.id, v]))
    return recent.flatMap((id) => byId.get(id) ?? []).slice(0, 5)
  }, [list.videos, recent])

  const item = (v: VideoListData['videos'][number], key: string) => (
    <li key={key}>
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
  )

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
          {query.trim() === '' && recentVideos.length > 0 && (
            <>
              <li className="list-label">최근</li>
              {recentVideos.map((v) => item(v, `recent-${v.id}`))}
              <li className="list-label">전체</li>
            </>
          )}
          {videos.map((v) => item(v, v.id))}
        </ul>
      )}
    </aside>
  )
}
