import { useEffect, useState } from 'react'

export default function App() {
  const [status, setStatus] = useState('…')
  useEffect(() => {
    fetch('/api/health').then(r => r.json()).then(d => setStatus(d.ok ? 'api ok' : 'api down'), () => setStatus('api down'))
  }, [])
  return <main><h1>MissinformationGPT</h1><p>{status}</p></main>
}
