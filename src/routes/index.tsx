import { createFileRoute } from '@tanstack/react-router'
import { getHealth } from '../functions/health.ts'

export const Route = createFileRoute('/')({
  loader: () => getHealth(),
  component: HomePage,
})

// M0: 환경 확인 화면. M3에서 영상 목록 화면으로 바뀐다.
function HomePage() {
  const health = Route.useLoaderData()
  return (
    <main>
      <h1>film</h1>
      <ul>
        <li>ffmpeg: {health.ffmpeg ?? '없음 — brew install ffmpeg'}</li>
        <li>
          FILM_DIR: {health.filmDir}{' '}
          {health.filmDirExists ? '✓' : '— 폴더를 찾을 수 없음'}
        </li>
      </ul>
    </main>
  )
}
