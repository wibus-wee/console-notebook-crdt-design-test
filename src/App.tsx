import './App.css'
import { NotebookView } from './components/in-page/NotebookView'
import { NotebookProvider } from './providers/NotebookProvider'

export default function App() {
  return (
    <NotebookProvider
      room="demo-notebook-room"
      serverUrl="ws://localhost:1234"
    >
      <div className="p-4 flex flex-col gap-2">
        <h2 className="font-bold">协同 Notebook 示例</h2>
        <NotebookView />
      </div>
    </NotebookProvider>
  )
}
