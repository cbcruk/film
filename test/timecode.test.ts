import { describe, expect, it } from 'vitest'
import {
  formatTimecode,
  sceneTimes,
  rangeTimes,
  frameFilename,
  frameUrl,
  intervalTimes,
} from '../src/lib/timecode.ts'

describe('timecode', () => {
  it('균등: 0초부터 간격마다, 영상 끝 전까지', () => {
    expect(intervalTimes(35, 10)).toEqual([0, 10, 20, 30])
    expect(intervalTimes(30, 10)).toEqual([0, 10, 20])
    expect(intervalTimes(4, 10)).toEqual([0])
    expect(intervalTimes(215.48, 1)).toHaveLength(216)
  })

  it('구간 분할은 양 끝을 뺀다', () => {
    expect(rangeTimes(10, 17, 6)).toEqual([11, 12, 13, 14, 15, 16])
    expect(rangeTimes(0, 1, 2)).toEqual([0.333, 0.667])
  })

  it('장면 모드는 찾은 전환을 모두 시간순으로', () => {
    const cuts = [
      { t: 80, score: 0.7 },
      { t: 10, score: 0.9 },
      { t: 10.5, score: 0.8 },
      { t: 1.23456, score: 0.3 },
      { t: 1.2349, score: 0.3 }, // 밀리초로 같은 시점
      { t: 100, score: 1 }, // 영상 끝
    ]
    expect(sceneTimes(cuts, 100)).toEqual([1.235, 10, 10.5, 80])
    expect(sceneTimes([], 100)).toEqual([])
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
