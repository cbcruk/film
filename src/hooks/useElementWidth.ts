import { useCallback, useRef, useState } from 'react'
import { flushSync } from 'react-dom'

/**
 * 요소의 안쪽 너비 (측정 전 0). 창 너비가 아니라 실제로 쓸 수 있는 폭으로
 * 레이아웃을 정한다 — 오른쪽 창을 끌어 넓히면 목록 폭이 바뀐다.
 *
 * 반환한 ref를 요소에 붙이면 그때 관찰을 시작하고, 요소가 빠지면 멈춘다
 * (React 19 ref 콜백의 정리 함수). onResize는 폭이 바뀔 때마다, 새 폭이 화면에
 * 반영된 뒤 불린다 — 그 폭에 맞춘 다른 값(예: 최대 크기)을 바로 쓸 수 있다.
 */
export const useElementWidth = <T extends HTMLElement>(
  onResize?: (width: number) => void,
) => {
  const [width, setWidth] = useState(0)
  // 관찰을 다시 시작하지 않고도 최신 콜백을 부르도록
  const onResizeRef = useRef(onResize)
  onResizeRef.current = onResize

  const ref = useCallback((node: T | null) => {
    if (!node) return
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      const next = entry.contentRect.width
      const onResize = onResizeRef.current
      if (!onResize) return setWidth(next)
      flushSync(() => setWidth(next))
      onResize(next)
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return [ref, width] as const
}
