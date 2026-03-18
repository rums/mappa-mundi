import { useState } from 'react';
import './App.css';

export function App() {
  const [projectPath, setProjectPath] = useState('');
  const [status, setStatus] = useState<'idle' | 'scanning' | 'ready' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isDisabled = projectPath.trim() === '' || status === 'scanning';

  function handleScan() {
    setStatus('scanning');
  }

  return (
    <div className="app">
      <header>
        <h1>Mappa Mundi</h1>
        <div className="scan-controls">
          <input
            type="text"
            value={projectPath}
            onChange={(e) => setProjectPath(e.target.value)}
            placeholder="Enter project path"
          />
          <button disabled={isDisabled} onClick={handleScan}>
            Scan
          </button>
        </div>
        <span data-status={status}>{status}</span>
      </header>
      <div className="main-content">
        <div className="map-container">
          {status === 'idle' && <p>Scan a project to begin</p>}
        </div>
        <div className="sidebar"></div>
      </div>
      {status === 'error' && errorMessage && (
        <div role="alert">{errorMessage}</div>
      )}
    </div>
  );
}
