# 썸네일 선택기 (film) — 스펙

> 상태: 초안 · 작성일 2026-11-06

로컬 동영상 파일에서 여러 시점의 썸네일을 만들어 브라우저에 보여주고, 사용자가 고른 **특정 시점 한 장**을 원본 해상도 이미지로 저장하는 **로컬 전용** 도구.

썸네일은 원하는 시점을 찾기 위한 탐색 수단일 뿐, 저장 대상이 아니다.

---

## 1. 목표와 범위

### 목표

- 동영상 파일을 고르면 일정 간격의 썸네일을 빠르게 보여준다.
- 썸네일로 시점을 고르면 그 시점의 원본 해상도 이미지를 보여주고, 브라우저의 **[이미지를 다른 이름으로 저장]**으로 저장한다.
- 수 GB 영상도 복사·업로드 없이 바로 처리한다.

### 범위 밖 (하지 않음)

- 원격 접속 / 다중 사용자 / 인증
- 파일 업로드 (서버와 브라우저가 같은 머신이라는 전제)
- 영상 편집, 트리밍, 인코딩
- 썸네일 묶음 저장, 여러 장 일괄 저장(ZIP)
- 앱 자체 저장 버튼·저장 위치 지정 (저장은 브라우저 기본 기능에 맡김)
- HDR 톤매핑 (대상 영상에 HDR 없음)
- Windows/Linux 전용 기능 (macOS 우선, 단 핵심 로직은 OS 무관하게 작성)

## 2. 전제 환경

| 항목             | 값                                                 |
| ---------------- | -------------------------------------------------- |
| OS               | macOS                                              |
| 런타임           | Node.js 26                                         |
| 프레임워크       | TanStack Start 1.x (React) — 클라이언트 + 서버     |
| ffmpeg / ffprobe | 9.x, `PATH`에 존재 (`/opt/homebrew/bin`)           |
| 바인딩           | `127.0.0.1` 전용                                   |
| 영상 폴더        | `.env`의 `FILM_DIR` (없으면 `~/Movies`) — 폴더 1개 |

```dotenv
# .env
FILM_DIR=~/Movies/MV
```

서버 시작 시 `ffmpeg -version`, `ffprobe -version`을 확인하고, 없으면 화면과 콘솔에 안내를 표시한다.

## 3. 용어

| 용어                    | 정의                                                                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **라이브러리(Library)** | `FILM_DIR` 폴더와 그 하위 폴더에 있는 영상 파일 목록                                                                                             |
| **소스(Source)**        | 라이브러리에서 사용자가 고른 영상 파일                                                                                                           |
| **소스 ID**             | `sha1(FILM_DIR 기준 상대경로 + size + mtimeMs)` 앞 16자. 같은 파일이면 같은 ID → 캐시 재사용. 클라이언트는 경로가 아닌 이 ID로만 파일을 가리킨다 |
| **시점(t)**             | 영상 내 위치(초, 소수점 3자리)                                                                                                                   |
| **썸네일(Thumbnail)**   | 그리드 표시용 축소 이미지 (기본 폭 320px, JPEG)                                                                                                  |
| **프레임(Frame)**       | 다운로드용 원본 해상도 이미지                                                                                                                    |
| **세트(Set)**           | 한 번의 생성 요청으로 만들어진 썸네일 묶음 (균등 분할 또는 특정 구간). 화면 탐색용이며 저장하지 않음                                             |

## 4. 사용자 흐름

```
1. 앱 열기 (http://127.0.0.1:3000)
2. FILM_DIR의 영상 목록이 최신순으로 표시됨 (파일명 검색 가능)
3. 영상 클릭 → 파일 정보 표시 (이름, 길이, 해상도, 코덱)
4. 썸네일이 생성되는 대로 그리드에 하나씩 나타남 (진행률 n/N)
5. 썸네일 클릭 → 그 시점의 원본 해상도 프레임이 미리보기 영역에 표시됨
6. (선택) 이전/다음 프레임 미세 조정, "이 구간 더 보기"
7. 미리보기 이미지 우클릭 → [이미지를 다른 이름으로 저장] (브라우저 기본 기능)
```

## 5. 기능 요구사항

### F1. 영상 목록에서 선택 — MVP

브라우저는 보안상 사용자가 고른 파일의 실제 경로를 알려주지 않는다. 경로를 모르면 원본을 그 자리에서 읽을 수 없고 업로드(복사)가 필요해진다. 그래서 **서버가 지정 폴더를 직접 읽어 목록을 보여주는 방식**으로 파일을 고른다.

- **F1-1** 서버는 `FILM_DIR`을 하위 폴더까지 탐색해 영상 목록을 만든다.
  - 대상 확장자: `.mp4 .webm .mkv .mov` (대소문자 무시). 숨김 파일·폴더(`.`으로 시작)는 제외.
  - 확장자는 1차 필터일 뿐이고, 실제 영상인지는 열 때 ffprobe로 확인한다 (F2).
  - 심볼릭 링크는 따라가지 않는다 (폴더 밖으로 나가는 것 방지).
- **F1-2** 목록 항목: 파일명, 하위 폴더 경로, 크기, 수정 시각, 썸네일 캐시 여부.
- **F1-3** 정렬은 수정 시각 최신순 (방금 받은 영상이 맨 위).
- **F1-4** 파일명 부분 일치 검색 (클라이언트에서 필터링).
- **F1-5** 목록은 화면 진입 시와 [새로고침] 버튼을 누를 때 다시 읽는다. 파일 변경 감시는 하지 않는다.
- **F1-6** `FILM_DIR`이 없거나 폴더가 아니면 화면에 안내 (`LIBRARY_NOT_FOUND`). 영상이 0개면 빈 상태 안내.

### F2. 메타데이터 확인 — MVP

- ffprobe로 duration, width, height, codec, rotation, fps를 읽는다.
- 비디오 스트림이 없거나 probe 실패 시 "지원하지 않는 파일" 에러.
- 회전 메타데이터가 있으면 표시 해상도는 회전 반영값(가로/세로 교환)으로 보여준다.

### F3. 썸네일 생성 — MVP

- **F3-1** 균등 모드는 **간격(초)**으로 고른다: 0초부터 N초마다, 영상 끝 전까지 (`intervalTimes`). 간격 선택: 1 / 2 / 5 / 10 / 30초, 기본 10초 (4분 영상 → 24장).
  - 처음에는 장수(6/12/24/48)로 2%~98% 구간을 나눴으나 사용자 요청으로 간격 기준으로 바꿨다. 시점이 0:10, 0:20처럼 떨어져 읽기 쉽다.
- **F3-2** 생성은 비동기 작업. 완료되는 순서대로 SSE로 클라이언트에 전달.
- **F3-3** 동시 ffmpeg 프로세스 수 = `max(1, floor(os.availableParallelism() / 2))`.
- **F3-4** 같은 소스 ID + 같은 시점의 썸네일은 캐시에서 재사용.
- **F3-5** 새 소스를 열면 이전 소스의 진행 중 작업은 취소(프로세스 kill).
- **F3-6** 구간 재생성: 두 시점 `from`~`to` 사이를 N장으로 다시 나눠 새 세트를 만든다. — M5 ✅
  - 화면: 썸네일을 선택하고 [이 구간 더 보기] → 앞뒤 썸네일 사이(끝 칸이면 세트 구간·영상 끝까지)를 12장으로 나눈다. 양 끝은 이미 본 장면이라 뺀다.
  - [전체 보기]로 원래 세트로 돌아간다 (캐시라 즉시).
- **F3-8** 실패한 썸네일 재시도: 카드의 [재시도]로 그 한 장만 다시 만든다. — M5 ✅
- **F3-7** 장면 전환 기반 모드. — M6 ✅
  - 헤더의 [균등 / 장면]으로 바꾼다 (URL `m=scene`).
  - 후보: 320px로 줄인 영상에서 장면 점수 `> 0.2` (실제 4분 뮤직비디오 측정: 0.2 초과 102개, 0.3 초과 84개, 분석 3.9초).
  - **찾은 전환을 모두 보여준다** (시간순, `sceneTimes`). 간격 선택은 균등 모드 전용이라 장면 모드에서는 숨긴다.
    - 처음에는 점수 상위 N개를 골랐으나(최소 간격 적용) 사용자 요청으로 전부 보여주도록 바꿨다.
  - 하나도 없으면 균등 분할로 대신하고 화면에 알린다.
  - 분석 결과는 캐시(`scenes.json`)에 저장해 두 번째부터는 즉시. 분석 중에는 경과 시간을 보여준다.

### F4. 그리드 / 미리보기 — MVP

- 썸네일 카드: 이미지 + 타임코드(`hh:mm:ss.mmm`, 1시간 미만이면 `mm:ss.mmm`).
- 생성 전 카드는 스켈레톤으로 자리를 잡아 레이아웃이 흔들리지 않게 한다.
- 클릭 또는 키보드(←/→ 이동, Enter 선택)로 선택.
- 선택 시 상단 미리보기 영역에 **원본 해상도 프레임**을 `<img>`로 표시 (화면에는 CSS로 맞춰 축소, 실제 이미지는 원본 크기).
- 원본 프레임이 로드되는 동안 썸네일을 확대해 자리표시로 보여준다.
- **F4-1** 미리보기에서 ±1프레임, ±1초 이동 버튼. — M5 ✅
  - 단축키: `,` / `.` = ±1프레임, `Shift+←/→` = ±1초 (`←/→`는 썸네일 선택). 1프레임 = `1/fps`.
  - 이동한 시점은 밀리초로 반올림하고 `0 ≤ t < duration`으로 제한한다.
- **F1-7** 최근 연 파일: 목록의 [최근] 탭 (브라우저 `localStorage`에 최대 10개 ID, 최신순). 지금 목록에 없는 ID(삭제·변경)는 숨긴다. — M5 ✅
- **F1-8** 화면 구조 (Astryx `table-inbox` 템플릿): 상단에 제목·검색·새로고침과 [전체 / 최근 / 썸네일 있음] 탭, 아래에 영상 표(파일·크기·수정일, 머리글을 눌러 정렬, 썸네일이 있으면 행 앞에 점). 행을 누르거나 Enter로 열면 오른쪽 창(끌어서 너비 조절, 기본 2/3)에 썸네일·미리보기가 열리고 [닫기]로 닫는다. 화면 폭이 900px 미만이면 연 영상이 화면 전체를 쓴다. 영상을 저절로 열지 않는다 (열면 썸네일 생성이 시작되므로).

### F5. 저장 — MVP

앱에는 별도 저장 버튼이 없다. 미리보기 `<img>`가 곧 저장 대상이다.

- 사용자는 브라우저 기본 기능 **[이미지를 다른 이름으로 저장]**(우클릭 메뉴, 또는 드래그해서 Finder에 놓기)으로 저장한다.
- 그래서 미리보기 이미지는 반드시 **원본 해상도 · 선택한 포맷 그대로**여야 한다 (축소본이나 canvas 재인코딩 금지).
- **기본 파일명**: 저장 창에 뜨는 이름이 의미 있도록 이미지 URL의 마지막 경로를 파일명으로 만든다.
  - 형식: `{원본파일명}_{mm}m{ss}s{ms}.{ext}` 예) `trip_03m12s450.png`
  - 응답 헤더에도 `Content-Disposition: inline; filename*=UTF-8''...`를 넣는다 (브라우저별 차이 대비).
- **포맷**: PNG(기본) / JPEG / WebP 중 선택. 바꾸면 미리보기 URL이 바뀐다. 마지막 선택값은 `localStorage`에 기억.
  - 선택지는 서버의 `Ffmpeg.formats`(설치된 ffmpeg가 인코딩할 수 있는 포맷)만 보여준다. Homebrew `ffmpeg` 9.0.2에는 `libwebp`가 없어 WebP가 빠진다 (M1 확인). WebP가 필요하면 libwebp가 포함된 빌드로 교체.
- 미리보기 아래에 "이미지를 우클릭해 [다른 이름으로 저장]" 안내 문구를 둔다.

## 6. 비기능 요구사항

| 항목                      | 기준                           |
| ------------------------- | ------------------------------ |
| 첫 썸네일 표시            | 목록에서 영상 클릭 후 1초 이내 |
| 12장 전체                 | 3초 이내                       |
| 원본 프레임 미리보기 표시 | 2초 이내                       |

> 기준 영상: **유튜브 뮤직비디오** (3~6분, 1080p~4K, H.264/VP9/AV1). 대상이 사실상 이것뿐이라 별도 대용량·장시간 대응은 하지 않는다. 위 수치는 참고용 목표이며 엄격히 측정하지 않는다.
> 설치된 ffmpeg 9.0.2에 해당 디코더(h264, vp9, libdav1d)가 모두 있음을 확인함.
> | 메모리 | 영상을 메모리에 올리지 않는다. 프레임은 이미지 한 장만 메모리에 모은 뒤 응답 (4K PNG도 수십 MB 이하) |
> | 디스크 | 캐시는 `~/.cache/film/` 아래, 총 1GB 초과 시 오래된 소스부터 삭제 |

## 7. 아키텍처

**TanStack Start (React)** 하나로 클라이언트와 서버를 함께 구현한다. 별도 백엔드 서버나 프록시를 두지 않는다.

```
[브라우저 — React (TanStack Router)]
   │                                   │
   │ 서버 함수 (RPC)                    │ 서버 라우트 (HTTP: 이미지, SSE)
   │ listVideos / openSource / createSet / retryThumb │ <img src>, EventSource
   ▼                                   ▼
[TanStack Start 서버 (Node, 127.0.0.1)]
   └─ src/server/   서버 전용 모듈 (Effect 서비스, runtime.ts로 실행)
        ├─ ffmpeg.ts   probe(), thumbnail(), frame()  ── spawn ──▶ ffmpeg / ffprobe
        ├─ jobs.ts     생성 작업, 동시성 제한, 취소, SSE 구독자
        ├─ library.ts  FILM_DIR 탐색, ID → 경로 조회, 폴더 밖 접근 차단
        └─ cache.ts    ~/.cache/film/{sourceId}/ 관리
```

### 서버 함수 vs 서버 라우트 — 나누는 기준

| 구분                                                               | 쓰는 곳                         | 이유                                                                                                                                                                     |
| ------------------------------------------------------------------ | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **서버 함수** (`createServerFn`)                                   | 영상 목록, 소스 열기, 세트 생성 | 입력·출력이 JSON. 타입이 클라이언트까지 그대로 이어짐                                                                                                                    |
| **서버 라우트** (`createFileRoute(...)({ server: { handlers } })`) | 썸네일·프레임 이미지, SSE       | `<img src>`와 `EventSource`는 **고정 URL**이 필요하고, 응답이 바이너리/스트림이라 `Response`를 직접 다뤄야 함. 특히 프레임 URL은 [다른 이름으로 저장]의 기본 파일명이 됨 |

### 디렉터리 구조

```
film/
  SPEC.md
  package.json
  vite.config.ts
  .env                                           # FILM_DIR (git 제외)
  .env.example
  .prettierrc                                    # semi: false, singleQuote: true
  vitest.config.ts                               # Start 플러그인 없이 서버 모듈만 테스트
  src/
    router.tsx
    start.ts                                     # createStart — 직렬화 어댑터(ServerError) 등록
    routes/
      __root.tsx
      index.tsx                                  # 화면 (단일 페이지)
      api/
        sources.$id.events.ts                    # SSE
        sources.$id.thumb.ts                     # 썸네일 JPEG (?t=)
        sources.$id.frame.$t.$filename.ts        # 원본 프레임 (저장 대상)
    functions/
      health.ts                                  # getHealth — ffmpeg·FILM_DIR 상태 (M0)
      sources.ts                                 # listVideos, openSource, createSet, retryThumb (서버 함수)
    server/                                      # 서버 전용 (Effect) — 서버 함수/라우트 핸들러 안에서만 import
      runtime.ts                                 # ManagedRuntime, runServerEffect / runRouteEffect (TanStack ↔ Effect 연결)
      errors.ts                                  # Tagged 에러 정의, 에러 → HTTP 상태/응답 변환
      config.ts                                  # FILM_DIR 등 Config
      schema.ts                                  # Effect Schema (입력 검증)
      ffmpeg.ts                                  # Ffmpeg 서비스
      jobs.ts                                    # Jobs 서비스
      library.ts                                 # Library 서비스
      frames.ts                                # 원본 프레임 추출·검증, Content-Disposition
      cache.ts                                   # Cache 서비스
    lib/                                         # 클라이언트·서버 공용 (순수 TS, Effect 미사용)
      timecode.ts                                # 타임코드 표기, 저장 파일명 생성
      types.ts                                   # 서버 응답·SSE 이벤트 타입, 에러 코드 유니온
      server-error.ts                            # ServerError 클래스 + 직렬화 어댑터 (클라이언트에서도 복원)
    components/
      VideoTable.tsx                             # 영상 표 (정렬, 썸네일 표시, 행 열기)
      ThumbnailGrid.tsx
      FramePreview.tsx
    machines/                                    # 클라이언트 상태 (xstate). 화면은 상태를 그리고 이벤트만 보낸다
      library.ts                                 # 목록: 탭·검색·정렬·최근 연 영상·새로고침
      source.ts                                  # 연 영상: 열기 → 썸네일 생성(SSE) → 구간 세트·재시도·다시 열기
      source.live.ts                             # source 머신의 실제 구현 (서버 함수 호출, EventSource 구독)
      frame.ts                                   # 원본 프레임 <img> 한 장의 로딩 (주소마다 새로 만든다)
    hooks/
      useElementWidth.ts                         # 요소 폭 측정 (나란히/전체 화면 전환)
    themes/film.ts                               # neutral 테마 확장 (글꼴 Noto Sans KR). 수정 후 astryx theme build
  test/
    global-setup.ts                              # 픽스처 영상 생성 (vitest globalSetup)
    fixtures/                                    # 생성된 픽스처 (git 제외). 다시 만들려면 폴더 삭제
    support/layers.ts                            # 테스트용 Layer (testConfig, ffmpegLive, libraryLive)
    fakes/ffmpeg.ts                              # 가짜 Ffmpeg (지연·실패·멈춤, 동시 실행 수 기록)
    config.test.ts                               # .env 로딩, 기본값
    process.test.ts                              # 인터럽트·타임아웃 시 자식 프로세스 종료
    ffmpeg.test.ts
    jobs.test.ts
    library.test.ts
    frames.test.ts
    timecode.test.ts
    machines.test.ts                             # 클라이언트 상태 머신 (가짜 서버로 흐름 확인)
```

### 기술 선택

- 프레임워크: **TanStack Start (`@tanstack/react-start` 1.169)** + React 19, Vite 8, TypeScript 7
- 서버 로직: **Effect 4.1 (`effect`)** + `@effect/platform-node` (ChildProcess·FileSystem 구현) — `src/server/*` 한정. React 화면에는 쓰지 않는다
- 클라이언트 상태: **XState 5 (`xstate`, `@xstate/react`)** — `src/machines/*`. 흐름을 상태 이름(여는 중·생성 중·완료·다시 여는 중…)으로 읽을 수 있게 한다
  - 연 영상·간격·방식은 공유·뒤로 가기를 위해 URL(`?v=&i=&m=`)에 두고, 머신은 그 값을 입력으로 받는다. 창 크기·폭 측정 같은 배치 값은 머신에 넣지 않는다
  - 서버 호출·SSE는 머신에 이름만 선언하고(`actors`), 실제 구현은 `source.live.ts`가 끼워 넣는다. 테스트는 가짜 구현으로 흐름만 확인한다 (`test/machines.test.ts`)
  - localStorage(최근 기록·저장 포맷)는 머신이 시작된 뒤에 읽는다. 첫 상태에서 읽으면 서버 HTML과 달라져 hydration 오류가 난다
  - 서버가 소스를 잃으면(SSE 404) 같은 조건으로 다시 연다. 연달아 3번 넘게 잃으면 실패로 끝낸다 (세트를 끝까지 받으면 횟수 초기화)
- 검증: **Effect Schema** → `Schema.toStandardSchemaV1(...)`로 서버 함수 `.validator()`에 연결
- 테스트: **Vitest 5** + `@effect/vitest`
- 포맷: **Prettier** (`semi: false`, `singleQuote: true`)
- 실행: `npm run dev` → `vite dev --host 127.0.0.1 --port 3000`
  - 로컬 도구라 상시 실행도 dev 모드로 충분하다. 빌드 실행(`npm start`)은 필요해지면 추가.

### 7-1. Effect 적용 설계

**적용 범위**

| 영역                                  | Effect | 비고                                                       |
| ------------------------------------- | ------ | ---------------------------------------------------------- |
| `src/server/*`                        | ✅     | 서비스·에러·설정·스키마 모두 Effect                        |
| `src/functions/*`, `src/routes/api/*` | 연결만 | 핸들러는 `runServerEffect(...)` 한 줄로 서버 Effect를 실행 |
| `src/lib/*`, 컴포넌트, 훅             | ❌     | 순수 TS. 서버 타입은 `import type`으로만 참조              |

**서비스 (Effect `Context` 태그 + `Layer`)**

| 서비스      | 책임                                                                                                                 | 의존              |
| ----------- | -------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `AppConfig` | `FILM_DIR`(기본 `~/Movies`), 캐시 경로, 동시성, 타임아웃                                                             | `Config`          |
| `Ffmpeg`    | `probe(path)`, `thumbnail(path, t, out)`, `frame(path, t, format) → Stream<Uint8Array>`, `checkInstalled`, `formats` | `AppConfig`       |
| `Library`   | `list()`, `resolve(id) → 절대경로` (폴더 밖 차단)                                                                    | `AppConfig`       |
| `Cache`     | 썸네일 경로, `meta.json`(probe 결과), 용량 정리                                                                      | `AppConfig`       |
| `Jobs`      | 세트 생성 작업, 동시성 제한, 이전 작업 취소, 이벤트 발행·재전송                                                      | `Ffmpeg`, `Cache` |

`AppLive = Jobs + Library + Cache + Ffmpeg + AppConfig` (Layer 합성). 테스트에서는 `Ffmpeg`를 가짜 Layer로 바꿔 끼운다.

**요구사항 → Effect 대응**

| 요구사항                         | 구현                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ffmpeg 프로세스 수명 (F3-5, 9절) | `effect/process`의 `ChildProcessSpawner.spawn`을 `Effect.scoped` 안에서 실행. 스코프가 닫히면(인터럽트 포함) **프로세스가 kill됨** — M0 테스트로 확인                                                                                                                                                                                                       |
| 30초 타임아웃                    | `Effect.timeout` 계열 → `FfmpegTimeout` 에러. 시간 초과도 인터럽트이므로 위 경로로 kill — M0 테스트로 확인                                                                                                                                                                                                                                                  |
| 동시성 제한 (F3-3)               | `Effect.forEach(times, extract, { concurrency: n })`                                                                                                                                                                                                                                                                                                        |
| 이전 작업 취소 (F3-5)            | `FiberHandle` 하나에 작업을 넣는다. 새 작업을 넣으면 이전 Fiber가 자동으로 인터럽트됨                                                                                                                                                                                                                                                                       |
| 클라이언트 연결 끊김             | `runRouteEffect(effect, request)`가 `request.signal`을 넘김 → abort 시 인터럽트                                                                                                                                                                                                                                                                             |
| SSE + 늦은 구독자 재전송         | 작업별 발행 기록(`Ref`) + `PubSub`. 구독 시 기록을 먼저 내보내고 이후 이벤트를 이어 붙인 `Stream`을 `ReadableStream`으로 변환. 발행과 구독 시작은 `Semaphore(1)`로 묶어 누락·중복이 없게 한다 (M2 테스트로 확인). PubSub은 작업이 취소·실패할 때만 닫는다 — 정상 종료 때 닫으면 느린 구독자가 아직 꺼내지 않은 `done`이 버려진다 (M4에서 발견, 테스트 추가) |
| 캐시 정리 (10절)                 | `Effect.repeat(cleanup, Schedule.spaced("1 hour"))`를 런타임 시작 시 백그라운드로 실행                                                                                                                                                                                                                                                                      |
| 에러 코드 (11절)                 | 코드별 `Schema.TaggedError`. 핸들러 경계에서 HTTP 상태/응답으로 변환 (누락 시 타입 에러)                                                                                                                                                                                                                                                                    |

**TanStack Start 연결 (`src/server/runtime.ts`)**

- `ManagedRuntime.make(AppLive)`로 런타임을 하나 만들어 `globalThis`에 보관한다. 서버 코드가 바뀌어 `runtime.ts`가 다시 평가되면(dev HMR) 이전 런타임을 `dispose`하고 새로 만든다 — 실행 중인 ffmpeg가 남지 않는다.
- 설정 로딩 실패는 복구할 수 없는 시작 오류이므로 `Layer.orDie`로 결함 처리한다.
- `runServerEffect(effect)` — 서버 함수용:
  - 성공 → 값 반환
  - 예상된 에러(Tagged) → `ServerError { code, message }`를 throw
  - 결함(defect) → 로그 후 `ServerError { code: 'INTERNAL' }`
- `runRouteEffect(effect, request)` — 서버 라우트용: 에러는 상태 코드 + JSON `Response`, 요청이 끊기면 `499`
- **ServerError 전달**: TanStack 기본 직렬화는 Error의 `message`만 보낸다(M0에서 확인). 그래서 `src/lib/server-error.ts`의 `ServerError`를 직렬화 어댑터로 `src/start.ts`에 등록해, 클라이언트에서도 `error instanceof ServerError && error.code`로 분기할 수 있게 한다.
- 서버 함수 예:
  ```ts
  const OpenSourceInput = Schema.toStandardSchemaV1(
    Schema.Struct({ id: SourceId, interval: ThumbInterval }),
  )

  export const openSource = createServerFn({ method: 'POST' })
    .validator(OpenSourceInput)
    .handler(({ data }) => runServerEffect(Jobs.openSource(data)))
  ```

### 7-2. 구현 시 주의

- **서버 상태 유지**: 작업 목록과 열린 소스 목록은 `Jobs` 서비스 안(`Ref`)에 둔다. 화면 코드만 바뀔 때는 런타임이 유지되고, 서버 코드가 바뀌면 런타임과 함께 초기화된다.
- **서버 전용 코드 분리**: `src/server/*` 파일 맨 위에 `import '@tanstack/react-start/server-only'`를 둔다 (클라이언트에서 import하면 빌드 에러). 서버 함수 `handler`·`validator`와 서버 라우트 `handlers` 안에서만 사용한다.
  - M0 확인: 서버 함수에 Effect Schema 검증기를 붙여도 클라이언트 번들에 `effect`가 포함되지 않는다 (RPC 스텁만 남음).
- **환경변수**: `.env`는 Vite가 아니라 `AppConfig`(Effect `ConfigProvider.fromDotEnv`)가 읽는다. 실행 위치(프로젝트 루트) 기준 `.env`. 환경변수가 있으면 그쪽이 우선.
- **CSRF**: `src/start.ts`에 `createCsrfMiddleware`를 서버 함수 전용으로 등록했다 (TanStack이 dev 서버에서 미등록 경고를 냄, M3). 같은 출처는 200, 다른 출처·헤더 없음은 403 확인.
- **화면 상태**: 선택한 영상·간격·방식은 URL 검색 파라미터(`?v={id}&i=10&m=scene`)에 둔다. 새로고침해도 유지되고, 서버는 같은 세트를 돌려준다.
- **StrictMode**: dev에서는 effect가 두 번 실행되어 `openSource`가 동시에 두 번 호출된다. `Jobs.open`은 `Semaphore(1)`로 한 번에 하나씩 처리해 같은 세트를 돌려준다 (M3에서 발견한 경쟁 상태, 테스트 추가).
- **키보드**: ←/→는 `window`에서 받는다 (Safari는 버튼을 클릭해도 포커스를 주지 않음). 입력창·선택 상자에서는 무시. 썸네일이 준비된 동안 source 머신이 `keyboard` 작업으로 듣고 NAVIGATE·STEP으로 바꾼다.
- **useEffect 없음**: 외부와의 동기화는 머신 작업(구독·단축키·저장소 읽기), `key`(주소가 바뀌면 이미지 머신 새로 만들기), ref 콜백(ResizeObserver)으로 한다. 오른쪽 창의 2/3 맞춤은 폭 측정 콜백에서 하고, 사용자가 끌면 멈춘다.
- **화면 확인**: 설치된 Chrome을 헤드리스로 띄워 DevTools 프로토콜로 확인한다 (로드 후 대기 → 스크린샷, 키 입력, 네트워크·SSE 기록).
- **Effect 버전**: v4는 v3와 모듈 구성·API 이름이 다르다. 설치된 패키지의 타입 정의와 `node_modules/effect/CLAUDE.md`·`ai-docs`를 기준으로 작성한다. TanStack도 `node_modules/@tanstack/*/skills`의 문서를 기준으로 한다 (예: 검증기 메서드는 `inputValidator`가 아니라 `validator`).
- **ffmpeg 확인**: `Ffmpeg.checkInstalled`로 확인하고, 실패하면 화면에 안내를 표시한다 (M0 화면에서 사용 중).

## 8. 서버 인터페이스

에러는 공통 형태 `{ code, message }` (11절 코드표). 서버 내부에서는 Tagged 에러로 다루고, `runServerEffect`가 경계에서 변환한다 — 서버 함수는 throw, 서버 라우트는 상태 코드와 함께 JSON으로 응답한다.

### 8-1. 서버 함수 (`src/functions/sources.ts`)

#### `listVideos()` — GET

`FILM_DIR`을 탐색해 영상 목록을 반환한다 (수정 시각 최신순).

```ts
{
  dir: "/Users/me/Movies/MV",
  videos: [
    {
      id: "a1b2c3d4e5f60718",
      name: "mv.webm",
      folder: "2026/11",          // FILM_DIR 기준 상대 폴더, 최상위면 ""
      size: 48213377,
      mtime: "2026-11-06T07:12:00Z",
      cached: true                // 썸네일 캐시 존재 여부
    }
  ]
}
```

- 에러: `LIBRARY_NOT_FOUND`
- 서버는 최근 목록의 `id → 절대경로` 대응표를 메모리에 보관한다 (`openSource`가 사용).

#### `openSource({ id, interval, mode? })` — POST

소스를 연다. 메타데이터를 읽고 기본 썸네일 세트 생성을 시작한다.

- `mode`: `'even'`(기본) | `'scene'` (M6). 장면 모드는 분석이 끝난 뒤 응답하고 찾은 전환을 모두 `times`로 돌려준다 (`interval`은 무시, 전환이 없을 때 균등 분할에만 쓴다). 반환값에 `mode`(실제로 쓴 방식)와 `sceneCuts`(찾은 전환 수)가 붙는다.

```ts
// 입력
{ id: "a1b2c3d4e5f60718", interval: 10 }
// 반환
{
  id: "a1b2c3d4e5f60718",
  name: "mv.webm",
  duration: 215.48,
  width: 1920, height: 1080,   // 회전 반영
  fps: 23.976,
  codec: "vp9",
  setId: "s1",
  times: [4.31, 23.12, ...]     // 세트의 시점 목록 (스켈레톤 카드·타임코드용)
}
```

- 에러: `FILE_NOT_FOUND` · `NOT_A_VIDEO`
- 같은 소스·같은 간격(장면 모드는 간격 무관)으로 다시 열면(화면 새로고침 등) 진행 중인 세트를 그대로 돌려준다 (같은 `setId`).
- probe 결과는 캐시의 `meta.json`을 재사용한다.

#### `createSet({ id, count, from, to })` — POST — M5

열린 소스의 `from`~`to` 구간을 `count`장으로 다시 나눈 새 세트를 만든다. 진행 중인 세트는 취소된다.

- 반환: `openSource`와 같은 형태 + `range: { from, to }`. 이벤트는 같은 SSE로 새 `setId`가 온다.
- 전체 세트로 돌아갈 때는 `openSource`를 다시 호출한다 (구간 세트는 재사용하지 않음).
- 에러: 열린 소스가 아니면 `FILE_NOT_FOUND`, `0 ≤ from < to ≤ duration`이 아니거나 너무 좁으면(한 장당 1ms 미만) `INVALID_PARAM`

#### `retryThumb({ id, setId, index })` — POST — M5

현재 세트의 썸네일 한 장을 다시 만들고 결과(`thumb` 또는 `error` 이벤트)를 **응답으로** 돌려준다 — 세트가 끝나 SSE가 닫힌 뒤에도 쓸 수 있도록.

- 서버의 이벤트 기록에서는 그 칸의 이벤트를 교체한다 (`done` 뒤에 덧붙이면 재연결 시 잘림). 구독 중인 연결에도 보낸다.
- 에러: 지난 `setId`·범위 밖 `index`는 `INVALID_PARAM`

### 8-2. 서버 라우트

#### `GET /api/sources/$id/events` — SSE

| event      | data                               |
| ---------- | ---------------------------------- |
| `thumb`    | `{ setId, index, t, url }`         |
| `progress` | `{ setId, done, total }`           |
| `done`     | `{ setId }`                        |
| `error`    | `{ setId, index?, code, message }` |

- `ReadableStream`으로 `text/event-stream` 응답.
- 연결 시 이미 완료된 썸네일을 먼저 모두 보낸다(늦은 구독 대응).
- `request.signal`이 abort되면 구독 해제.
- `done`을 보낸 뒤 연결을 닫는다. `EventSource`는 연결이 닫히면 자동으로 재연결하므로, 클라이언트는 `done`을 받으면 직접 `close()`한다 (재연결해도 같은 이벤트를 다시 받을 뿐 문제는 없다).
- 열린 소스(가장 최근 `openSource`)가 아니면 `404 FILE_NOT_FOUND` → 클라이언트는 `openSource`를 다시 호출. 새 소스를 열면 이전 소스의 스트림은 `done` 없이 끝난다.

#### `GET /api/sources/$id/thumb?t=12.345`

썸네일 JPEG (캐시). `Cache-Control: max-age=31536000, immutable`

- 캐시에 있는 것만 보낸다 (생성은 `Jobs`). 없으면 `404 FILE_NOT_FOUND`. `t`는 숫자 형식 문자열만 허용 (`''`·`-1` 등은 `400`).

#### `GET /api/sources/$id/frame/$t/$filename`

예) `/api/sources/a1b2c3d4e5f60718/frame/192.450/mv_03m12s450.png`

- 미리보기 `<img src>`로 쓰이며, 이 URL이 그대로 [다른 이름으로 저장]의 대상이 된다.
- `$t` — 시점(초). `$filename`의 확장자로 포맷 결정 (`.png | .jpg | .webp`).
- `$filename`은 표시용. 서버는 확장자만 읽고, 이름 부분은 `Content-Disposition`에 그대로 반영한다.
- 항상 원본 해상도. 응답은 `Content-Disposition: inline; filename*=UTF-8''...`
- 응답은 ffmpeg 출력을 **다 받은 뒤** 보낸다 (M4에서 스트리밍 대신 선택). 헤더(200)를 보낸 뒤 ffmpeg가 실패하면 깨진 이미지가 되기 때문 — 실패는 상태 코드로 알린다. `request.signal` abort 시 인터럽트되어 프로세스 kill.
- 검증: 확장자가 `Ffmpeg.formats`에 있어야 하고, `t < duration` (probe 결과는 캐시의 `meta.json`), 파일명에 경로 구분자 없음. 어기면 `400 INVALID_PARAM`.
- `Content-Disposition`에는 ASCII 대체 이름(`filename=`)과 UTF-8 이름(`filename*=`)을 함께 넣는다.
- 같은 URL은 결과가 같으므로 `Cache-Control: max-age=31536000, immutable` (포맷 왕복 시 브라우저 캐시 재사용).

### 8-3. 검증 규칙 (`src/server/schema.ts`, Effect Schema)

- `id` — `/^[0-9a-f]{16}$/`, 열린 소스 목록에 있어야 함
- `t` — 유한한 숫자, `0 ≤ t < duration`, 소수점 3자리로 반올림
- `filename` — 확장자 `png | jpg | webp`, 경로 구분자(`/`, `\`) 없음. 확장자가 `Ffmpeg.formats`에 없으면 `INVALID_PARAM`
- `interval` — `1 | 2 | 5 | 10 | 30` (초, 균등 모드)
- `count` — `6 | 12 | 24 | 48` (구간 재생성, 화면은 12 고정)
- 클라이언트는 경로를 보내지 않는다. 서버가 `id`로 경로를 찾은 뒤, 실제 경로(`realpath`)가 `FILM_DIR` 안에 있는지 한 번 더 확인한다.

## 9. ffmpeg 명령

모든 호출은 `spawn(cmd, args[])` — 쉘을 거치지 않는다. 기본 타임아웃 30초, 초과 시 `SIGKILL`.

**probe**

```bash
ffprobe -v error -select_streams v:0 \
  -show_entries format=duration:stream=width,height,codec_name,avg_frame_rate:stream_side_data=rotation \
  -of json <path>
```

**썸네일**

```bash
ffmpeg -v error -ss <t> -i <path> -frames:v 1 -vf scale=320:-2 -q:v 4 -y <cache>/thumb_<t>.jpg
```

- `-ss`를 `-i` 앞에 둔다(빠른 seek + 정확한 위치).
- 임시 파일에 쓴 뒤 `rename`으로 원자적 교체(동시 요청 시 깨진 파일 방지).

**원본 프레임**

```bash
ffmpeg -v error -ss <t> -i <path> -frames:v 1 -f image2pipe -c:v <png | mjpeg -q:v 2 | libwebp -quality 90> pipe:1
```

- 클라이언트 연결이 끊기면 프로세스 kill.

**장면 분석 (M6)**

```bash
ffmpeg -v error -an -sn -i <path> -vf "scale=320:-2,select='gt(scene,0.2)',metadata=print:file=-" -f null -
```

- stdout의 `pts_time:` / `lavfi.scene_score=` 줄을 읽는다. 경로는 `-i` 인자라 필터 문자열 이스케이프가 필요 없다.
- 영상 전체를 디코딩하므로 타임아웃은 따로 3분(`sceneTimeout`, 4K 대비).
- 분석은 한 번에 하나씩, `openSource`의 잠금 밖에서 한다 (분석 중에도 다른 소스를 열 수 있게). 동시에 같은 영상을 요청하면 두 번째는 캐시를 읽는다.
- `-ss t`는 t 이후 첫 프레임을 가져온다 (예: 30fps에서 2.818 → 2.833초 프레임). 썸네일도 같은 방식이라 썸네일과 원본 프레임은 같은 장면이다.

**M1 확인 사항**

- 영상 길이를 넘는 시점은 ffmpeg가 **exit 0으로 끝나면서 출력이 없다**. 그래서 썸네일은 파일 존재, 프레임은 출력 바이트 수(0이면 실패)로 `ExtractFailed`를 판단한다.
- 프레임 스트림은 stderr를 따로 읽어둔다 (안 읽으면 파이프가 차서 멈출 수 있음). 실패 메시지는 stderr 내용.
- 회전 메타데이터가 있는 영상은 ffmpeg가 출력 이미지에 회전을 자동 적용한다 → 프레임 크기 = probe의 표시 크기.
- 타임아웃: 수집형(probe·thumbnail)은 `Effect.timeoutOrElse`, 스트림형(frame)은 `Stream.interruptWhen`. 둘 다 프로세스가 남지 않음을 테스트로 확인.

## 10. 캐시

```
~/.cache/film/
  {sourceId}/
    meta.json            # probe 결과 + 원본 경로
    scenes.json          # 장면 전환 후보 [{ t, score }] (M6)
    thumb_12.345.jpg
```

- 소스 ID에 size·mtime이 포함되므로 원본이 바뀌면 자동으로 새 캐시.
- 서버 시작 시 + 1시간마다 총 용량 확인, 1GB 초과 시 최근 접근 순으로 정리.
  - "최근 접근" = `meta.json`의 수정 시각. 소스를 열 때마다 갱신한다.

## 11. 에러 처리

| 코드                | Effect 에러 (`_tag`)  | HTTP | 상황                                         | UI 표시                                                          |
| ------------------- | --------------------- | ---- | -------------------------------------------- | ---------------------------------------------------------------- |
| `FFMPEG_MISSING`    | `FfmpegMissing`       | 503  | 시작 시 ffmpeg 없음                          | 화면 전체 안내 ("ffmpeg를 설치하세요: `brew install ffmpeg`")    |
| `LIBRARY_NOT_FOUND` | `LibraryNotFound`     | 503  | `FILM_DIR`이 없거나 폴더가 아님              | "영상 폴더를 찾을 수 없습니다. `.env`의 `FILM_DIR`을 확인하세요" |
| `FILE_NOT_FOUND`    | `FileNotFound`        | 404  | 목록 이후 파일이 삭제·이동됨 / 알 수 없는 ID | "파일을 찾을 수 없습니다" + 목록 새로고침                        |
| `NOT_A_VIDEO`       | `NotAVideo`           | 415  | 비디오 스트림 없음 / probe 실패              | "지원하지 않는 파일입니다"                                       |
| `EXTRACT_FAILED`    | `ExtractFailed`       | 500  | 특정 시점 추출 실패                          | 해당 카드에 ⚠ + 재시도 버튼                                      |
| `TIMEOUT`           | `FfmpegTimeout`       | 504  | ffmpeg 30초 초과                             | 해당 카드에 ⚠ + 재시도 버튼                                      |
| `INVALID_PARAM`     | `ParseError` (Schema) | 400  | 검증 실패                                    | 개발자 오류 — 콘솔 로그                                          |

- 에러 코드 유니온(`ErrorCode`)은 `src/lib/types.ts`에 두어 화면도 같은 코드를 쓴다.
- 예상 못 한 결함(defect)은 코드표에 없으며 `500` + 서버 로그로 처리한다.

## 12. 테스트

Vitest + `@effect/vitest` 사용. `src/server/*`는 TanStack과 무관한 Effect 서비스로, `src/lib/*`는 순수 함수로 작성해 단독으로 테스트한다.

- **실제 ffmpeg 테스트**: `Ffmpeg` 실구현(`FfmpegLive`) + 픽스처 영상
- **가짜 Layer 테스트**: `Jobs`는 `FfmpegFake`(지연·실패·멈춤을 조절 가능)를 주입해 동시성·취소·재전송을 검증
- **시간 관련 테스트**: `TestClock`으로 30초 타임아웃, 1시간 캐시 정리를 실제로 기다리지 않고 검증

- 픽스처는 테스트 시작 시 생성: `ffmpeg -f lavfi -i testsrc2=duration=10:size=640x360:rate=30 -c:v libx264 fixture.mp4` (+ VP9 `.webm` 버전, 회전 메타데이터 버전, 오디오만 있는 파일)
- **ffmpeg.ts**: probe 결과값, 지정 시점 추출 이미지 크기, 타임아웃·인터럽트 시 프로세스가 남지 않는지
- **jobs.ts**: 동시성 한도 준수, 새 소스 열기 시 이전 작업 인터럽트, 늦은 구독자 재전송
- **runtime.ts**: Tagged 에러별 HTTP 상태 변환, defect → 500
- **library.ts**: 임시 폴더로 확장자 필터·숨김 제외·하위 폴더 탐색·최신순 정렬, 심볼릭 링크로 폴더 밖을 가리키는 경우 제외
- **timecode.ts**: 포맷/파일명 생성
- **schema.ts**: 검증 규칙별 통과/거부 (`src/server/schema.ts`)
- **서버 라우트**: 잘못된 파라미터에 4xx, 프레임 응답의 `Content-Type`·`Content-Disposition`

## 13. 마일스톤

| 단계      | 내용                                                                                                                                                                               |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **M0** ✅ | TanStack Start 프로젝트 생성, `127.0.0.1:3000` 실행, Vitest·`@effect/vitest`·Prettier 설정, `.env` 로딩. `runtime.ts`·`errors.ts` 골격, 환경 확인 화면. 확인 결과는 7-1·7-2에 반영 |
| **M1** ✅ | `Ffmpeg`·`Library`·`AppConfig` 서비스 + 테스트                                                                                                                                     |
| **M2** ✅ | 서버 함수 `listVideos`, `openSource`, 썸네일 작업(`jobs.ts`) + SSE 라우트                                                                                                          |
| **M3** ✅ | 화면: 영상 목록(F1), 썸네일 그리드                                                                                                                                                 |
| **M4** ✅ | 원본 해상도 미리보기 + [다른 이름으로 저장] 파일명·포맷 확인 (F4, F5) → **MVP 완료**                                                                                               |
| **M5** ✅ | 구간 재생성, 프레임 미세 조정, 최근 파일, 실패한 썸네일 재시도                                                                                                                     |
| **M6** ✅ | 장면 기반 모드                                                                                                                                                                     |

## 14. 열린 질문

- 없음 (2026-11-06 기준 모두 결정됨)
