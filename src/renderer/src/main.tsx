import { createRoot } from 'react-dom/client'
import App from './App'
import OutputView from './components/OutputView'
import './styles.css'

const isOutput = window.location.hash.startsWith('#output')
const container = document.getElementById('root')

if (!container) throw new Error('Falta el contenedor #root')

createRoot(container).render(isOutput ? <OutputView /> : <App />)
