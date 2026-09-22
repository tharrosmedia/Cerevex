'use client';

import { useState } from 'react';

export default function Login() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      window.location.href = '/';
    } else {
      setError('That password did not match. Try again.');
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <p className="login-eyebrow">Cerevex</p>
        <h1>Sign in</h1>
        <p className="login-lede">
          Ads and SEO for home-service businesses. One place to run the store.
        </p>
        <form onSubmit={handleSubmit}>
          <label htmlFor="password" className="visually-hidden">Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoComplete="current-password"
            required
          />
          {error && <p className="login-error">{error}</p>}
          <button type="submit" className="btn-cta login-submit">
            Sign in
          </button>
        </form>
      </div>
    </div>
  );
}
