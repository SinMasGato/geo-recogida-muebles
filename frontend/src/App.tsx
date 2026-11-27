import { useEffect, useState } from 'react';
import { AuthScreen } from './components/AuthScreen';
import { MapView } from './components/MapView';
import { AuthProvider, useAuth } from './context/AuthContext';
import {
  getInitialLocale,
  getLocaleDirection,
  Locale,
  translations,
} from './i18n/translations';

function AppShell() {
  const { user, loading, logout } = useAuth();
  const [locale, setLocale] = useState<Locale>(getInitialLocale);
  const t = translations[locale];

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = getLocaleDirection(locale);
  }, [locale]);

  const handleLocaleChange = (loc: Locale) => {
    setLocale(loc);
    try {
      localStorage.setItem('remueble_locale', loc);
    } catch {
      // Modo privado estricto
    }
  };

  if (loading) {
    return <div className="center-screen">{t.loadingSession}</div>;
  }

  if (!user) {
    return <AuthScreen locale={locale} onLocaleChange={handleLocaleChange} />;
  }

  return (
    <MapView
      user={user}
      locale={locale}
      onLocaleChange={handleLocaleChange}
      onLogout={logout}
    />
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  );
}