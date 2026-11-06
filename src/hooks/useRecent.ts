import { useCallback, useEffect, useState } from 'react'

const KEY = 'film.recent'
const LIMIT = 10

const read = (): ReadonlyArray<string> => {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(value)
      ? value.filter((v): v is string => typeof v === 'string')
      : []
  } catch {
    return []
  }
}

/** 최근 연 영상 ID (최신순, 최대 10개). 이 브라우저의 localStorage에만 둔다 */
export const useRecent = () => {
  const [recent, setRecent] = useState<ReadonlyArray<string>>([])

  // 서버 렌더링과 어긋나지 않도록 마운트 후에 읽는다
  useEffect(() => setRecent(read()), [])

  const add = useCallback((id: string) => {
    const next = [id, ...read().filter((v) => v !== id)].slice(0, LIMIT)
    try {
      localStorage.setItem(KEY, JSON.stringify(next))
    } catch {
      // 저장 공간 문제 등은 무시 (편의 기능)
    }
    setRecent(next)
  }, [])

  return [recent, add] as const
}
