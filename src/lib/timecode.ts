// 시점 계산·표기와 URL 생성. 클라이언트·서버 공용 (순수 함수)

/** 시점 문자열. 밀리초 3자리로 고정해 같은 시점은 항상 같은 키·URL이 된다 */
export const timeKey = (t: number) => t.toFixed(3)

/** 균등 모드: 0초부터 interval초마다 (영상 끝 전까지). 시점이 0:10, 0:20처럼 떨어져 읽기 쉽다 */
export const intervalTimes = (duration: number, interval: number) =>
  Array.from({ length: Math.max(1, Math.ceil(duration / interval)) }, (_, k) =>
    Number(timeKey(k * interval)),
  ).filter((t) => t < duration || t === 0)

/** from~to 사이를 count장으로 나눈 시점. 양 끝(이미 본 장면)은 빼고 안쪽만 */
export const rangeTimes = (from: number, to: number, count: number) =>
  Array.from({ length: count }, (_, i) =>
    Number(timeKey(from + ((to - from) * (i + 1)) / (count + 1))),
  )

export interface SceneCut {
  readonly t: number
  readonly score: number
}

/**
 * 장면 모드의 시점: 찾은 전환을 모두 쓴다 (F3-7). 시간순, 밀리초 반올림, 중복·영상 끝 이후 제외.
 */
export const sceneTimes = (
  cuts: ReadonlyArray<SceneCut>,
  duration: number,
): ReadonlyArray<number> =>
  [
    ...new Set(
      cuts.filter((c) => c.t < duration).map((c) => Number(timeKey(c.t))),
    ),
  ].sort((a, b) => a - b)

const pad = (n: number, width = 2) => String(n).padStart(width, '0')

const split = (t: number) => {
  const totalMs = Math.round(t * 1000)
  return {
    h: Math.floor(totalMs / 3_600_000),
    m: Math.floor(totalMs / 60_000) % 60,
    s: Math.floor(totalMs / 1000) % 60,
    ms: totalMs % 1000,
  }
}

/** 화면 표기: 1시간 미만 `mm:ss.mmm`, 이상 `hh:mm:ss.mmm` */
export const formatTimecode = (t: number) => {
  const { h, m, s, ms } = split(t)
  const rest = `${pad(m)}:${pad(s)}.${pad(ms, 3)}`
  return h > 0 ? `${pad(h)}:${rest}` : rest
}

/** 저장 파일명: `{원본파일명}_{mm}m{ss}s{ms}.{ext}` (1시간 이상이면 `{hh}h` 추가) */
export const frameFilename = (videoName: string, t: number, ext: string) => {
  const base = videoName.replace(/\.[^.]+$/, '')
  const { h, m, s, ms } = split(t)
  const stamp = `${h > 0 ? `${pad(h)}h` : ''}${pad(m)}m${pad(s)}s${pad(ms, 3)}`
  return `${base}_${stamp}.${ext}`
}

export const thumbUrl = (id: string, t: number) =>
  `/api/sources/${id}/thumb?t=${timeKey(t)}`

export const frameUrl = (
  id: string,
  videoName: string,
  t: number,
  ext: string,
) =>
  `/api/sources/${id}/frame/${timeKey(t)}/${encodeURIComponent(frameFilename(videoName, t, ext))}`

export const eventsUrl = (id: string) => `/api/sources/${id}/events`
