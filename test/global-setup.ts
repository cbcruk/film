import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export const FIXTURES = path.resolve(import.meta.dirname, 'fixtures')

const ffmpeg = (out: string, args: string[]) => {
  const file = path.join(FIXTURES, out)
  if (existsSync(file)) return
  execFileSync('ffmpeg', ['-v', 'error', ...args, '-y', file])
}

// 이미 있으면 다시 만들지 않는다. 내용을 바꿨다면 test/fixtures/를 지우고 다시 실행.
export default function setup() {
  mkdirSync(FIXTURES, { recursive: true })
  const src = ['-f', 'lavfi', '-i', 'testsrc2=duration=10:size=640x360:rate=30']

  ffmpeg('h264.mp4', [...src, '-c:v', 'libx264', '-pix_fmt', 'yuv420p'])
  ffmpeg('vp9.webm', [
    '-f',
    'lavfi',
    '-i',
    'testsrc2=duration=4:size=640x360:rate=24',
    '-c:v',
    'libvpx-vp9',
    '-deadline',
    'realtime',
    '-cpu-used',
    '8',
  ])
  // 회전 메타데이터만 붙인 버전 (픽셀은 640x360, 표시 크기는 360x640)
  ffmpeg('rotated.mp4', [
    '-display_rotation',
    '90',
    '-i',
    path.join(FIXTURES, 'h264.mp4'),
    '-c',
    'copy',
  ])
  // 2초마다 장면이 바뀌는 영상 (단색 → 단색 → 패턴 → 단색): 전환 2·4·6초
  ffmpeg('scenes.mp4', [
    '-f',
    'lavfi',
    '-i',
    'color=c=red:s=320x180:r=30:d=2',
    '-f',
    'lavfi',
    '-i',
    'color=c=blue:s=320x180:r=30:d=2',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=s=320x180:r=30:d=2',
    '-f',
    'lavfi',
    '-i',
    'color=c=yellow:s=320x180:r=30:d=2',
    '-filter_complex',
    '[0][1][2][3]concat=n=4:v=1:a=0,format=yuv420p',
    '-c:v',
    'libx264',
  ])
  ffmpeg('audio-only.mp4', [
    '-f',
    'lavfi',
    '-i',
    'sine=duration=2',
    '-c:a',
    'aac',
  ])
  const fake = path.join(FIXTURES, 'not-a-video.mp4')
  if (!existsSync(fake)) writeFileSync(fake, 'this is not a video\n')
}
