import { useEffect, useRef, useState } from 'react'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import type { Awareness } from 'y-protocols/awareness'

interface UseYProviderOptions {
  room: string
  serverUrl: string
  connect?: boolean
}

/**
 * Hook to manage Yjs WebsocketProvider lifecycle.
 * Handles auto connect/disconnect, status tracking, and cleanup.
 */
export function useYProvider({ room, serverUrl, connect = true }: UseYProviderOptions) {
  const [doc] = useState(() => new Y.Doc())
  const providerRef = useRef<WebsocketProvider | null>(null)
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting')
  const [awareness, setAwareness] = useState<Awareness | null>(null)

  useEffect(() => {
    if (!connect) return
    const provider = new WebsocketProvider(serverUrl, room, doc, { connect })
    providerRef.current = provider
    setAwareness(provider.awareness)

    const handleStatus = (e: { status: string }) => {
      setStatus(e.status === 'connected' ? 'connected' : 'disconnected')
    }
    provider.on('status', handleStatus)

    return () => {
      // Ensure full cleanup to avoid leaked intervals & event handlers
      provider.off('status', handleStatus)
      try {
        provider.awareness.setLocalState(null)
      } catch {}
      // destroy() also disconnects and removes Y.Doc/Awareness listeners
      provider.destroy()
      providerRef.current = null
      setAwareness(null)
      setStatus('disconnected')
    }
  }, [room, serverUrl, connect, doc])

  return { doc, provider: providerRef.current, status, awareness }
}
