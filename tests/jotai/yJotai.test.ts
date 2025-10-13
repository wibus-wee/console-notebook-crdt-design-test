import { describe, it, expect, vi } from 'vitest'
import * as Y from 'yjs'
import { createStore } from 'jotai'
import {
  createYAtom,
  createYArrayIndexAtom,
  createYMapKeyAtom,
  createYPathAtom,
  createYTextAtom,
  withTransact,
} from '@/yjs/jotai/yJotai'

describe('createYAtom', () => {
  it('emits initial snapshot, filters events, and writes inside transactions', () => {
    const doc = new Y.Doc()
    const map = doc.getMap<{ count: number }>('m')

    const targetAtom = createYAtom({
      y: map,
      read: (m) => {
        const value = m.get('target')
        return value ? { count: value.count } : { count: -1 }
      },
      write: (m, next) => {
        m.set('target', { count: next.count })
      },
      eventFilter: (evt) => Boolean(evt.keysChanged?.has('target')),
    })

    const store = createStore()
    const seen: Array<{ count: number }> = []

    const unsubscribe = store.sub(targetAtom, () => {
      seen.push(store.get(targetAtom))
    })
    seen.push(store.get(targetAtom))
    expect(seen.at(-1)).toEqual({ count: -1 })

    const baseline = seen.length
    map.set('other', { count: 1 })
    expect(seen.length).toBe(baseline)

    map.set('target', { count: 5 })
    expect(store.get(targetAtom)).toEqual({ count: 5 })
    expect(seen.at(-1)).toEqual({ count: 5 })

    const afterTarget = seen.length

    map.set('target', { count: 5 })
    expect(seen.length).toBe(afterTarget)

    const transactSpy = vi.spyOn(doc, 'transact')
    store.set(targetAtom, (prev) => ({ count: prev.count + 1 }))
    expect(transactSpy).toHaveBeenCalledTimes(1)
    expect(map.get('target')).toEqual({ count: 6 })
    expect(seen.at(-1)).toEqual({ count: 6 })
    expect(seen.length).toBe(afterTarget + 1)

    const afterWrite = seen.length
    transactSpy.mockClear()
    store.set(targetAtom, { count: 6 })
    expect(transactSpy).not.toHaveBeenCalled()
    expect(seen.at(-1)).toEqual({ count: 6 })
    expect(seen.length).toBe(afterWrite)

    transactSpy.mockRestore()
    unsubscribe()
  })

  it('supports deep observation without hitting the event filter', () => {
    const doc = new Y.Doc()
    const root = doc.getMap<Y.Map<number>>('root')
    const nested = new Y.Map<number>()
    nested.set('value', 0)
    root.set('nested', nested)

    const nestedAtom = createYAtom<number>({
      y: root,
      deep: true,
      equals: (a, b) => a === b,
      eventFilter: () => false,
      read: (m) => {
        const n = m.get('nested')
        return n instanceof Y.Map ? (n.get('value') ?? -1) : -1
      },
      write: (m, next) => {
        const n = m.get('nested')
        if (n instanceof Y.Map) {
          n.set('value', next)
        }
      },
    })

    const store = createStore()
    const seen: number[] = []

    const unsubscribe = store.sub(nestedAtom, () => {
      seen.push(store.get(nestedAtom))
    })
    seen.push(store.get(nestedAtom))
    expect(seen.at(-1)).toBe(0)

    nested.set('value', 10)
    expect(store.get(nestedAtom)).toBe(10)
    expect(seen.at(-1)).toBe(10)

    store.set(nestedAtom, 20)
    expect((root.get('nested') as Y.Map<number>).get('value')).toBe(20)
    expect(seen.at(-1)).toBe(20)

    root.delete('nested')
    expect(store.get(nestedAtom)).toBe(-1)
    expect(seen.at(-1)).toBe(-1)

    unsubscribe()
  })
})

describe('createYPathAtom', () => {
  it('navigates nested structures and applies default writes', () => {
    const doc = new Y.Doc()
    const root = doc.getMap('root')
    const list = new Y.Array<Y.Map<any>>()
    const entry = new Y.Map<any>()
    entry.set('title', 'note')
    list.insert(0, [entry])
    root.set('list', list)

    const pathAtom = createYPathAtom<string | undefined>(root, ['list', 0, 'title'], {
      equals: (a, b) => a === b,
    })

    const store = createStore()
    const seen: Array<string | undefined> = []

    const unsubscribe = store.sub(pathAtom, () => {
      seen.push(store.get(pathAtom))
    })
    seen.push(store.get(pathAtom))
    expect(seen.at(-1)).toBe('note')

    entry.set('title', 'updated')
    expect(store.get(pathAtom)).toBe('updated')
    expect(seen.at(-1)).toBe('updated')

    store.set(pathAtom, 'final')
    expect(entry.get('title')).toBe('final')
    expect(seen.at(-1)).toBe('final')

    list.delete(0, 1)
    expect(store.get(pathAtom)).toBeUndefined()
    expect(seen.at(-1)).toBeUndefined()

    unsubscribe()
  })

  it('respects custom read/write transformations', () => {
    const doc = new Y.Doc()
    const root = doc.getMap('root')
    const items = new Y.Array<Y.Map<any>>()
    const mapEntry = new Y.Map<any>()
    mapEntry.set('value', 1)
    items.insert(0, [mapEntry])
    root.set('items', items)

    const formattedAtom = createYPathAtom<string>(root, ['items', 0, 'value'], {
      equals: (a, b) => a === b,
      read: (node) => (typeof node === 'number' ? `#${node}` : 'none'),
      write: (parent, last, next) => {
        if (parent instanceof Y.Map && typeof last === 'string') {
          const numeric = Number(next.replace(/^#/, ''))
          parent.set(last, numeric)
        }
      },
    })

    const store = createStore()
    const seen: string[] = []

    const unsubscribe = store.sub(formattedAtom, () => {
      seen.push(store.get(formattedAtom))
    })
    seen.push(store.get(formattedAtom))
    expect(seen.at(-1)).toBe('#1')

    store.set(formattedAtom, '#5')
    expect(mapEntry.get('value')).toBe(5)
    expect(store.get(formattedAtom)).toBe('#5')
    expect(seen.at(-1)).toBe('#5')

    unsubscribe()
  })
})

describe('specialised adapters', () => {
  it('createYMapKeyAtom updates only when the key changes', () => {
    const doc = new Y.Doc()
    const map = doc.getMap<number>('m')
    const keyAtom = createYMapKeyAtom<number, number>(map, 'a', {
      decode: (v) => (typeof v === 'number' ? v : 0),
    })

    const store = createStore()
    const seen: number[] = []

    const unsubscribe = store.sub(keyAtom, () => {
      seen.push(store.get(keyAtom))
    })
    seen.push(store.get(keyAtom))
    expect(seen.at(-1)).toBe(0)

    map.set('b', 2)
    expect(seen.length).toBe(1)

    map.set('a', 5)
    expect(store.get(keyAtom)).toBe(5)
    expect(seen.at(-1)).toBe(5)
    expect(seen.length).toBe(2)

    map.set('a', 5)
    expect(seen.length).toBe(2)

    unsubscribe()
  })

  it('createYArrayIndexAtom reacts to index shifts and value changes', () => {
    const doc = new Y.Doc()
    const arr = doc.getArray<number>('a')
    arr.insert(0, [1, 2, 3])

    const idxAtom = createYArrayIndexAtom<number, number>(arr, 1, {
      decode: (v) => (typeof v === 'number' ? v : -1),
    })

    const store = createStore()
    const seen: number[] = []

    const unsubscribe = store.sub(idxAtom, () => {
      seen.push(store.get(idxAtom))
    })
    seen.push(store.get(idxAtom))
    expect(seen.at(-1)).toBe(2)

    arr.insert(0, [99])
    expect(store.get(idxAtom)).toBe(1)
    expect(seen.at(-1)).toBe(1)

    const lastIndex = arr.length - 1
    arr.delete(lastIndex, 1)
    arr.insert(lastIndex, [42])
    expect(store.get(idxAtom)).toBe(1)
    expect(seen.at(-1)).toBe(1)

    arr.delete(1, 1)
    arr.insert(1, [1])
    const before = seen.length
    expect(store.get(idxAtom)).toBe(1)
    expect(seen.length).toBe(before)

    unsubscribe()
  })

  it('createYTextAtom reads and writes string content', () => {
    const doc = new Y.Doc()
    const text = doc.getText('t')
    text.insert(0, 'hi')
    const textAtom = createYTextAtom(text)

    const store = createStore()
    const seen: string[] = []

    const unsubscribe = store.sub(textAtom, () => {
      seen.push(store.get(textAtom))
    })
    seen.push(store.get(textAtom))
    expect(seen.at(-1)).toBe('hi')

    store.set(textAtom, 'hello')
    expect(text.toString()).toBe('hello')
    expect(store.get(textAtom)).toBe('hello')
    expect(seen.at(-1)).toBe('hello')

    const before = seen.length
    store.set(textAtom, 'hello')
    expect(seen.length).toBe(before)

    unsubscribe()
  })
})

describe('withTransact', () => {
  it('wraps callbacks with doc.transact when a document is provided', () => {
    const doc = new Y.Doc()
    const transactSpy = vi.spyOn(doc, 'transact')
    const callback = vi.fn()

    withTransact(doc, callback)
    expect(transactSpy).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledTimes(1)

    transactSpy.mockRestore()
  })

  it('executes callback immediately when no document is available', () => {
    const callback = vi.fn()
    withTransact(null, callback)
    expect(callback).toHaveBeenCalledTimes(1)
  })
})
