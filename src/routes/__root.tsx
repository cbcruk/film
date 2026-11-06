import type { ReactNode } from 'react'
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
} from '@tanstack/react-router'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { Theme } from '@astryxdesign/core/theme'
import { VStack } from '@astryxdesign/core/VStack'
import { defaultThemeSlug, themes } from '../astryx-themes.ts'
import appCss from '../styles.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'film — 썸네일 선택기' },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  component: RootComponent,
  notFoundComponent: () => <EmptyState title="페이지를 찾을 수 없습니다" />,
})

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  )
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ko">
      <head>
        <HeadContent />
      </head>
      <body>
        <Theme theme={themes[defaultThemeSlug]}>
          {/* 화면 높이에 맞춰 목록·본문이 각자 스크롤된다 */}
          <VStack height="100dvh">{children}</VStack>
        </Theme>
        <Scripts />
      </body>
    </html>
  )
}
