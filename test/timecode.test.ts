import { describe, expect, it } from 'vitest'
import {
  formatTimecode,
  pickScenes,
  rangeTimes,
  frameFilename,
  frameUrl,
  thumbnailTimes,
} from '../src/lib/timecode.ts'

describe('timecode', () => {
  it('2%~98% 균등 분할, 밀리초 반올림', () => {
    expect(thumbnailTimes(100, 6)).toEqual([2, 21.2, 40.4, 59.6, 78.8, 98])
    expect(thumbnailTimes(215.48, 12)).toHaveLength(12)
    for (const t of thumbnailTimes(215.48, 48)) {
      expect(Number(t.toFixed(3))).toBe(t)
      expect(t).toBeLessThan(215.48)
    }
  })

  it('구간 분할은 양 끝을 뺀다', () => {
    expect(rangeTimes(10, 17, 6)).toEqual([11, 12, 13, 14, 15, 16])
    expect(rangeTimes(0, 1, 2)).toEqual([0.333, 0.667])
  })

  it('장면 선택: 점수 높은 순, 최소 간격, 시간순', () => {
    const cuts = [
      { t: 10, score: 0.9 },
      { t: 10.5, score: 0.8 }, // 10과 너무 가까움 (간격 100 / (3*4) = 8.3)
      { t: 50, score: 0.5 },
      { t: 80, score: 0.7 },
      { t: 30, score: 0.3 },
    ]
    expect(pickScenes(cuts, 3, 100)).toEqual([10, 50, 80])
    expect(pickScenes(cuts, 10, 100)).toEqual([10, 30, 50, 80])
    expect(pickScenes([], 6, 100)).toEqual([])
    expect(pickScenes([{ t: 100, score: 1 }], 6, 100)).toEqual([])
    expect(pickScenes([{ t: 1.23456, score: 1 }], 6, 100)).toEqual([1.235])
  })

  it('타임코드 표기', () => {
    expect(formatTimecode(0)).toBe('00:00.000')
    expect(formatTimecode(192.45)).toBe('03:12.450')
    expect(formatTimecode(3725.0005)).toBe('01:02:05.001')
  })

  it('저장 파일명', () => {
    expect(frameFilename('trip.mp4', 192.45, 'png')).toBe('trip_03m12s450.png')
    expect(frameFilename('a.b.webm', 3725, 'jpg')).toBe('a.b_01h02m05s000.jpg')
    expect(frameFilename('noext', 1, 'png')).toBe('noext_00m01s000.png')
  })

  it('프레임 URL은 파일명을 인코딩한다', () => {
    expect(frameUrl('a1b2c3d4e5f60718', '뮤비 #1.mp4', 192.45, 'png')).toBe(
      '/api/sources/a1b2c3d4e5f60718/frame/192.450/%EB%AE%A4%EB%B9%84%20%231_03m12s450.png',
    )
  })
})
