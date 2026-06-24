import React, { useState } from 'react';
import { AgentLogo } from '../components/Icons';
import { loginWithGoogle } from '../lib/auth';
import type { AuthUser } from '../lib/auth';

interface Props {
  agentServiceUrl: string;
  onLogin: (user: AuthUser) => void;
}

export default function LoginView({ agentServiceUrl, onLogin }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  async function handleGoogle() {
    setLoading(true);
    setError('');
    try {
      const user = await loginWithGoogle(agentServiceUrl);
      onLogin(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', height: '100%', gap: 24, padding: 32,
    }}>
      <AgentLogo size={48} />

      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
          Đăng nhập
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', maxWidth: 260 }}>
          Đăng nhập để sử dụng Browser Agent và lưu lịch sử hội thoại của bạn.
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%', maxWidth: 260 }}>
        <button
          onClick={handleGoogle}
          disabled={loading}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            padding: '10px 16px', borderRadius: 8, border: '1px solid var(--border)',
            background: 'var(--bg-elevated)', color: 'var(--text-primary)',
            cursor: loading ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 500,
            opacity: loading ? 0.6 : 1, transition: 'opacity 0.15s',
          }}
        >
          {loading ? (
            <span style={{ animation: 'spin 0.8s linear infinite', display: 'inline-block', fontSize: 16 }}>⟳</span>
          ) : (
            <GoogleIcon />
          )}
          {loading ? 'Đang đăng nhập…' : 'Tiếp tục với Google'}
        </button>
      </div>

      {error && (
        <div style={{
          fontSize: 12, color: 'var(--error)', textAlign: 'center',
          padding: '8px 12px', background: 'rgba(239,68,68,0.07)',
          border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, maxWidth: 260,
        }}>
          {error}
        </div>
      )}
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  );
}
