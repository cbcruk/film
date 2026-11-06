import { createServerFn } from '@tanstack/react-start'
import { Effect } from 'effect'
import { FileSystem } from 'effect'
import { NodeServices } from '@effect/platform-node'
import type { Health } from '../lib/types.ts'
import { AppConfig } from '../server/config.ts'
import { Ffmpeg } from '../server/ffmpeg.ts'
import { runServerEffect } from '../server/runtime.ts'

export const getHealth = createServerFn({ method: 'GET' }).handler(() =>
  runServerEffect(
    Effect.gen(function* () {
      const config = yield* AppConfig
      const ffmpeg = yield* Ffmpeg
      const fs = yield* FileSystem.FileSystem
      const version = yield* Effect.option(ffmpeg.checkInstalled)
      const info = yield* Effect.option(fs.stat(config.filmDir))
      const health: Health = {
        ffmpeg: version._tag === 'Some' ? version.value : null,
        filmDir: config.filmDir,
        filmDirExists: info._tag === 'Some' && info.value.type === 'Directory',
      }
      return health
    }).pipe(Effect.provide(NodeServices.layer)),
  ),
)
