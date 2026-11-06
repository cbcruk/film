import { createStart } from '@tanstack/react-start'
import { serverErrorAdapter } from './lib/server-error.ts'

export const startInstance = createStart(() => ({
  serializationAdapters: [serverErrorAdapter],
}))
