import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Locale, LOCALE_OPTIONS, translations } from '../i18n/translations';

interface AuthScreenProps {
  locale: Locale;
  onLocaleChange: (loc: Locale) => void;
}

export function AuthScreen({ locale, onLocaleChange }: AuthScreenProps) {
  const t = translations[locale];
  const { login, register } = useAuth();

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === 'login') {
        await login(email.trim(), password);
      } else {
        await register(email.trim(), password, displayName.trim());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="auth-shell">
      <div className="lang-bar" role="group" aria-label="Idioma / Language">
        {LOCALE_OPTIONS.map((opt) => (
          <button
            key={opt.code}
            type="button"
            lang={opt.code}
            dir={opt.dir}
            className={`lang-pill ${locale === opt.code ? 'active' : ''}`}
            onClick={() => onLocaleChange(opt.code)}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <section className="auth-card">
        <header className="auth-header">
          <div className="brand-badge" aria-hidden="true">
            🪑
          </div>
          <h1>{t.appTitle}</h1>
          <p>{t.appSubtitle}</p>
        </header>

        <form className="auth-form" onSubmit={handleSubmit}>
          {mode === 'register' && (
            <label className="field">
              <span>{t.displayName}</span>
              <input
                type="text"
                required
                minLength={2}
                maxLength={80}
                autoComplete="name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Alex BCN"
              />
            </label>
          )}

          <label className="field">
            <span>{t.email}</span>
            <input
              type="email"
              dir="ltr"
              required
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="nombre@correo.com"
            />
          </label>

          <label className="field">
            <span>{t.password}</span>
            <input
              type="password"
              dir="ltr"
              required
              minLength={mode === 'register' ? 8 : 1}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
            {mode === 'register' && <small className="hint">{t.passwordHint}</small>}
          </label>

          {error && (
            <div className="error-banner" role="alert">
              {error}
            </div>
          )}

          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? '...' : mode === 'login' ? t.submitLogin : t.submitRegister}
          </button>
        </form>

        <button
          type="button"
          className="btn-link"
          onClick={() => {
            setError(null);
            setMode(mode === 'login' ? 'register' : 'login');
          }}
        >
          {mode === 'login' ? t.switchToRegister : t.switchToLogin}
        </button>
      </section>
    </main>
  );
}