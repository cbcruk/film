import { useLayoutEffect, useRef, useState } from 'react'

/**
 * 요소의 안쪽 너비 (측정 전 0). 창 너비가 아니라 실제로 쓸 수 있는 폭으로
 * 레이아웃을 정한다 — 오른쪽 창을 끌어 넓히면 목록 폭이 바뀐다.
 */
export const useElementWidth = <T extends HTMLElement>() => {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)

  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width)
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return [ref, width] as const
}
