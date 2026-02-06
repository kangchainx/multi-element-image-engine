import { useState, useEffect } from 'react'
import './App.css'

interface SystemStats {
  system?: {
    os?: string;
    python_version?: string;
  };
  devices?: string[];
}

function App() {
  const [stats, setStats] = useState<SystemStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Example API call to backend via proxy
    fetch('/api/system_stats')
      .then(response => {
        if (!response.ok) {
          throw new Error('Backend not available')
        }
        return response.json()
      })
      .then(data => {
        setStats(data)
        setLoading(false)
      })
      .catch(err => {
        setError(err.message)
        setLoading(false)
      })
  }, [])

  return (
    <div className="App">
      <header className="App-header">
        <h1>Multi-Element Image Engine</h1>
        <p className="subtitle">ComfyUI Integration Frontend</p>
        
        <div className="info-card">
          <h2>Backend Status</h2>
          {loading && <p>Connecting to backend...</p>}
          {error && (
            <div className="error">
              <p>❌ Backend unavailable: {error}</p>
              <p className="hint">Make sure ComfyUI is running on port 8000</p>
            </div>
          )}
          {stats && (
            <div className="success">
              <p>✅ Connected to ComfyUI</p>
              {stats.system && (
                <div className="stats">
                  <p><strong>OS:</strong> {stats.system.os}</p>
                  <p><strong>Python:</strong> {stats.system.python_version}</p>
                </div>
              )}
              {stats.devices && stats.devices.length > 0 && (
                <div className="stats">
                  <p><strong>Devices:</strong> {stats.devices.join(', ')}</p>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="getting-started">
          <h3>Getting Started</h3>
          <ol>
            <li>Ensure ComfyUI is running on port 8000</li>
            <li>The frontend automatically proxies <code>/api/*</code> to the backend</li>
            <li>Start building your image generation UI here!</li>
          </ol>
        </div>
      </header>
    </div>
  )
}

export default App
