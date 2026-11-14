import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

function App() {
  const [status, setStatus] = useState('Sjekker tilkobling …');
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/health/ready', { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('Backend unavailable');
        return response.json();
      })
      .then(() => setStatus('API og database er tilkoblet'))
      .catch((error) => {
        if (error.name !== 'AbortError') setStatus('Kan ikke koble til API og database');
      });
    return () => controller.abort();
  }, []);

  return (
    <main>
      <p className="eyebrow">TEXTANITY / CMS</p>
      <h1>Et sted for<br />det du vil si.</h1>
      <p className="intro">Grunnlaget er på plass. Neste steg er å forme innholdet.</p>
      <p className="status" role="status">{status}</p>
      <footer>JavaScript · React · Fastify · PostgreSQL</footer>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>);
