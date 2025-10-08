import { beforeAll, afterAll } from 'vitest'

const NOISY = 'Client-side notebook initialization occurred unexpectedly.'

let originalWarn: typeof console.warn

beforeAll(() => {
  originalWarn = console.warn
  console.warn = (...args: any[]) => {
    const first = args[0]
    if (typeof first === 'string' && first.includes(NOISY)) return
    return originalWarn(...args)
  }
})

afterAll(() => {
  console.warn = originalWarn
})

