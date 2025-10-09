import './App.css'
import { Provider } from 'jotai'
import { jotaiStore } from './lib/jotai'

function App() {
  return (
    <>
      <Provider store={jotaiStore}>

      </Provider>
    </>
  )
}

export default App
