import { AsyncLocalStorage } from 'node:async_hooks'

export type LogContext = {
  requestId?: string
  parentRequestId?: string
  userId?: number
  taskId?: string
  taskType?: string
}

const storage = new AsyncLocalStorage<LogContext>()

export function getLogContext(): LogContext {
  return storage.getStore() ?? {}
}

export async function runWithLogContext<T>(context: LogContext, fn: () => Promise<T>): Promise<T> {
  return await storage.run(context, fn)
}

export function runWithLogContextSync<T>(context: LogContext, fn: () => T): T {
  return storage.run(context, fn)
}
