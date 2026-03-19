import React from 'react';

interface SpinnerProps {
  message?: string;
  size?: number;
}

export function Spinner({ message, size = 32 }: SpinnerProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      <svg width={size} height={size} viewBox="0 0 24 24" style={{ animation: 'spin 1s linear infinite' }}>
        <circle cx="12" cy="12" r="10" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="3" />
        <path
          d="M12 2a10 10 0 0 1 10 10"
          fill="none"
          stroke="#53a8e2"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
      {message && (
        <div style={{ color: '#8899aa', fontSize: 13, textAlign: 'center' }}>{message}</div>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
