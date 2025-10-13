import { NotebookView } from './components/in-page/NotebookView'
import { NotebookProvider } from './providers/NotebookProvider'
import { ThemeProvider } from './providers/ThemeProvider'
import { ThemeToggle } from './components/ThemeToggle'
import { Badge } from './components/ui/Badge'

export default function App() {
  return (
    <ThemeProvider defaultTheme="light" storageKey="notebook-theme">
      <div className="min-h-screen bg-background transition-colors duration-200">
        {/* Top Navigation Bar - Vercel Style */}
        <nav className="sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur-xl">
          <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
            <div className="flex items-center gap-3">
              {/* Vercel Triangle Logo */}
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-foreground transition-transform hover:scale-105">
                <svg
                  width="16"
                  height="14"
                  viewBox="0 0 76 65"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  className="text-background"
                >
                  <path
                    d="M37.5274 0L75.0548 65H0L37.5274 0Z"
                    fill="currentColor"
                  />
                </svg>
              </div>
              <div className="flex flex-col">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold leading-none">RisingWave SQL Notebook CRDT Design</span>
                  <Badge variant="secondary" className="text-[10px]">Test</Badge>
                </div>
                <span className="text-xs text-muted-foreground">Real-time Collaboration</span>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <a
                href="https://github.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                </svg>
              </a>
              <ThemeToggle />
            </div>
          </div>
        </nav>

        {/* Main Content */}
        <main className="mx-auto max-w-6xl px-6 py-12">
          <NotebookProvider
            room="demo-notebook-room"
            serverUrl="ws://localhost:1234"
          >
            <NotebookView />
          </NotebookProvider>
        </main>

        {/* Footer */}
        <footer className="mt-16 border-t border-border/60 py-8">
          <div className="mx-auto max-w-6xl px-6">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <p>Powered by Yjs & Monaco Editor</p>
              <div className="flex items-center gap-4">
                <a href="#" className="transition-colors hover:text-foreground">Documentation</a>
                <a href="#" className="transition-colors hover:text-foreground">GitHub</a>
                <a href="#" className="transition-colors hover:text-foreground">Support</a>
              </div>
            </div>
          </div>
        </footer>
      </div>
    </ThemeProvider>
  )
}
