import { NodeServices } from '@effect/platform-node'
import { assert, describe, it } from '@effect/vitest'
import { Deferred, Effect, Fiber } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'

const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

// 스펙 7-1: 인터럽트되면 자식 프로세스가 반드시 종료되어야 한다.
describe('ChildProcess 수명', () => {
  it.live('Fiber를 인터럽트하면 실행 중인 프로세스가 종료된다', () =>
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const started = yield* Deferred.make<number>()

      const fiber = yield* Effect.forkChild(
        Effect.scoped(
          Effect.gen(function* () {
            const handle = yield* spawner.spawn(
              ChildProcess.make('sleep', ['30']),
            )
            yield* Deferred.succeed(started, handle.pid)
            yield* handle.exitCode
          }),
        ),
      )

      const pid = yield* Deferred.await(started)
      assert.isTrue(isAlive(pid))

      yield* Fiber.interrupt(fiber)
      yield* Effect.sleep('200 millis')
      assert.isFalse(isAlive(pid))
    }).pipe(Effect.provide(NodeServices.layer)),
  )

  it.live('타임아웃이 나도 프로세스가 종료된다', () =>
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      let pid = 0

      const result = yield* Effect.scoped(
        Effect.gen(function* () {
          const handle = yield* spawner.spawn(
            ChildProcess.make('sleep', ['30']),
          )
          pid = handle.pid
          yield* handle.exitCode
        }),
      ).pipe(Effect.timeout('300 millis'), Effect.option)

      assert.strictEqual(result._tag, 'None')
      yield* Effect.sleep('200 millis')
      assert.isFalse(isAlive(pid))
    }).pipe(Effect.provide(NodeServices.layer)),
  )
})
