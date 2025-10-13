import { createContext, useContext, useMemo } from 'react'
import { createNotebookAtoms } from '@/yjs/jotai/notebookAtoms'
import { useYProvider } from './WebsocketProvider'
import { AwarenessProvider } from './AwarenessProvider'

const NotebookAtomsContext = createContext<ReturnType<typeof createNotebookAtoms> | null>(null)
const NotebookStatusContext = createContext<'connecting' | 'connected' | 'disconnected'>('connecting')

export function NotebookProvider({
  room,
  serverUrl,
  children,
}: {
  room: string
  serverUrl: string
  children: React.ReactNode
}) {
  const { doc, status, awareness } = useYProvider({ room, serverUrl })
  const nb = useMemo(() => doc.getMap('root'), [doc])
  const atoms = useMemo(() => createNotebookAtoms(nb), [nb])

  return (
    <AwarenessProvider awareness={awareness}>
      <NotebookAtomsContext.Provider value={atoms}>
        <NotebookStatusContext.Provider value={status}>
          {children}
        </NotebookStatusContext.Provider>
      </NotebookAtomsContext.Provider>
    </AwarenessProvider>
  )
}

export function useNotebookAtoms() {
  const ctx = useContext(NotebookAtomsContext)
  if (!ctx) throw new Error('useNotebookAtoms must be used within NotebookProvider')
  return ctx
}

export function useNotebookStatus() {
  return useContext(NotebookStatusContext)
}
