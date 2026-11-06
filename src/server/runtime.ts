import '@tanstack/react-start/server-only'
import { NodeServices } from '@effect/platform-node'
import { Cause, Effect, Exit, Layer, ManagedRuntime, Option } from 'effect'
import { ServerError } from '../lib/server-error.ts'
import type { ErrorBody } from '../lib/types.ts'
import { AppConfig, configProviderLayer } from './config.ts'
import { type AppError, toErrorBody, toStatus } from './errors.ts'
import { Ffmpeg } from './ffmpeg.ts'
import { Library } from './library.ts'

// 설정 로딩 실패는 복구할 수 없는 시작 오류이므로 결함(defect)으로 처리한다.
export const AppLive = Layer.mergeAll(Ffmpeg.layer, Library.layer).pipe(
  Layer.provideMerge(AppConfig.layer),
  Layer.provide(configProviderLayer()),
  Layer.provideMerge(NodeServices.layer),
  Layer.orDie,
)

export type AppServices = Layer.Success<typeof AppLive>
type AppRuntime = ManagedRuntime.ManagedRuntime<
  AppServices,
  Layer.Error<typeof AppLive>
>

// 서버 코드가 바뀌어 이 모듈이 다시 평가되면(dev HMR) 이전 런타임을 정리하고 새로 만든다.
// 그 외(화면 코드 변경 등)에는 같은 런타임이 유지된다.
const store = globalThis as { __filmRuntime?: AppRuntime }
if (store.__filmRuntime) void store.__filmRuntime.dispose()
const runtime: AppRuntime = ManagedRuntime.make(AppLive)
store.__filmRuntime = runtime

type Outcome<A> =
  | { readonly _tag: 'ok'; readonly value: A }
  | {
      readonly _tag: 'error'
      readonly status: number
      readonly body: ErrorBody
    }
  | { readonly _tag: 'interrupted' }

const run = async <A>(
  effect: Effect.Effect<A, AppError, AppServices>,
  signal?: AbortSignal,
): Promise<Outcome<A>> => {
  const exit = await runtime.runPromiseExit(effect, { signal })
  if (Exit.isSuccess(exit)) return { _tag: 'ok', value: exit.value }

  const error = Cause.findErrorOption(exit.cause)
  if (Option.isSome(error)) {
    return {
      _tag: 'error',
      status: toStatus(error.value),
      body: toErrorBody(error.value),
    }
  }
  if (Cause.hasInterruptsOnly(exit.cause)) return { _tag: 'interrupted' }

  console.error(Cause.pretty(exit.cause))
  return {
    _tag: 'error',
    status: 500,
    body: { code: 'INTERNAL', message: '서버 내부 오류' },
  }
}

/** 서버 함수 handler용. 실패하면 ServerError를 던진다. */
export const runServerEffect = async <A>(
  effect: Effect.Effect<A, AppError, AppServices>,
): Promise<A> => {
  const outcome = await run(effect)
  if (outcome._tag === 'ok') return outcome.value
  if (outcome._tag === 'interrupted') {
    throw new ServerError({
      code: 'INTERNAL',
      message: '작업이 취소되었습니다',
    })
  }
  throw new ServerError(outcome.body)
}

/** 서버 라우트 handler용. 요청이 끊기면(request.signal) Effect를 인터럽트한다. */
export const runRouteEffect = async (
  effect: Effect.Effect<Response, AppError, AppServices>,
  request: Request,
): Promise<Response> => {
  const outcome = await run(effect, request.signal)
  if (outcome._tag === 'ok') return outcome.value
  if (outcome._tag === 'interrupted') return new Response(null, { status: 499 })
  return Response.json(outcome.body, { status: outcome.status })
}
