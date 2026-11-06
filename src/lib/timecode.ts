// 시점 계산·표기와 URL 생성. 클라이언트·서버 공용 (순수 함수)

/** 시점 문자열. 밀리초 3자리로 고정해 같은 시점은 항상 같은 키·URL이 된다 */
export const timeKey = (t: number) => t.toFixed(3)

/** 영상의 2%~98% 구간을 count장으로 균등 분할한 시점 (밀리초 반올림) */
export const thumbnailTimes = (duration: number, count: number) => {
  const from = duration * 0.02
  const to = duration * 0.98
  return Array.from({ length: count }, (_, i) =>
    Number(timeKey(from + ((to - from) * i) / Math.max(1, count - 1))),
  )
}

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
