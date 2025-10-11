import { useNotebookStatus, useNotebookAtoms } from '@/providers/NotebookProvider'
import { useAtom } from 'jotai'


export function NotebookView() {
  const status = useNotebookStatus()
  const atoms = useNotebookAtoms()
  const [title, setTitle] = useAtom(atoms.titleAtom)

  if (status !== 'connected') return <div>Connecting...</div>

  return (
    <>
      <input
        className="border rounded p-2"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="请输入标题"
      />
      <p className="text-gray-500">当前标题：{title}</p>
    </>
  )
}
