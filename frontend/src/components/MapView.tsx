import { useCallback, useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import {
  CATEGORY_ICONS,
  Locale,
  LOCALE_OPTIONS,
  PIN_CATEGORY_LIST,
  translations,
} from '../i18n/translations';
import { usePinEvents } from '../hooks/usePinEvents';
import { api } from '../services/api';
import { PinCategory, PinSummary, User } from '../types/api';
import { PinDetailSheet } from './PinDetailSheet';
import { QuickPublishSheet } from './QuickPublishSheet';

interface MapViewProps {
  user: User;
  locale: Locale;
  onLocaleChange: (loc: Locale) => void;
  onLogout: () => Promise<void>;
}

// Centro inicial: Plaça Catalunya, Barcelona
const DEFAULT_CENTER: [number, number] = [41.3874, 2.1686];
const DEFAULT_ZOOM = 14;

export function MapView({ user, locale, onLocaleChange, onLogout }: MapViewProps) {
  const t = translations[locale];

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const userLocationMarkerRef = useRef<L.CircleMarker | null>(null);
  const fetchDebounceRef = useRef<number | null>(null);

  const [pins, setPins] = useState<PinSummary[]>([]);
  const [activeCategory, setActiveCategory] = useState<PinCategory | null>(null);
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);
  const [pickingLocation, setPickingLocation] = useState(false);
  const [publishCoords, setPublishCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [zoomWarning, setZoomWarning] = useState(false);
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const [toast, setToast] = useState<{ text: string; isError: boolean } | null>(null);

  const activeCategoryRef = useRef<PinCategory | null>(activeCategory);
  activeCategoryRef.current = activeCategory;
  const userCoordsRef = useRef<{ lat: number; lng: number } | null>(userCoords);
  userCoordsRef.current = userCoords;

  const showToast = useCallback((text: string, isError = false) => {
    setToast({ text, isError });
    window.setTimeout(() => {
      setToast((curr) => (curr?.text === text ? null : curr));
    }, 3200);
  }, []);

  const fetchVisiblePins = useCallback(async () => {
    const map = mapRef.current;
    if (!map) return;

    const bounds = map.getBounds();
    const minLat = bounds.getSouth();
    const minLng = bounds.getWest();
    const maxLat = bounds.getNorth();
    const maxLng = bounds.getEast();

    // Evita superar el límite anti-scraping de 0.30° del backend
    if (maxLat - minLat > 0.28 || maxLng - minLng > 0.28) {
      setZoomWarning(true);
      setPins([]);
      return;
    }

    setZoomWarning(false);
    try {
      const results = await api.searchPinsByBbox({
        minLat,
        minLng,
        maxLat,
        maxLng,
        lat: userCoordsRef.current?.lat,
        lng: userCoordsRef.current?.lng,
        category: activeCategoryRef.current ?? undefined,
      });
      setPins(results);
    } catch {
      // Silencioso en red inestable; el próximo movimiento o SSE lo reintenta
    }
  }, []);

  // Canal en tiempo real SSE
  const { connected: sseConnected } = usePinEvents({
    enabled: true,
    onCreated: (newPin) => {
      if (activeCategoryRef.current && newPin.category !== activeCategoryRef.current) return;
      setPins((prev) => {
        const exists = prev.some((p) => p.id === newPin.id);
        return exists ? prev.map((p) => (p.id === newPin.id ? newPin : p)) : [newPin, ...prev];
      });
    },
    onUpdated: (updatedPin) => {
      setPins((prev) =>
        prev.map((p) =>
          p.id === updatedPin.id
            ? { ...updatedPin, distanceMeters: updatedPin.distanceMeters ?? p.distanceMeters }
            : p
        )
      );
    },
    onDeleted: (pinId) => {
      setPins((prev) => prev.filter((p) => p.id !== pinId));
      setSelectedPinId((curr) => (curr === pinId ? null : curr));
    },
    onResync: () => {
      void fetchVisiblePins();
    },
  });

  // Inicialización del mapa Leaflet (compatible con React 18 StrictMode)
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      zoomControl: false,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap',
    }).addTo(map);

    const markersLayer = L.layerGroup().addTo(map);
    mapRef.current = map;
    markersLayerRef.current = markersLayer;

    const scheduleFetch = () => {
      if (fetchDebounceRef.current !== null) {
        window.clearTimeout(fetchDebounceRef.current);
      }
      fetchDebounceRef.current = window.setTimeout(() => {
        void fetchVisiblePins();
      }, 300);
    };

    map.on('moveend', scheduleFetch);
    void fetchVisiblePins();

    return () => {
      if (fetchDebounceRef.current !== null) {
        window.clearTimeout(fetchDebounceRef.current);
      }
      map.off('moveend', scheduleFetch);
      map.remove();
      mapRef.current = null;
      markersLayerRef.current = null;
      userLocationMarkerRef.current = null;
    };
  }, [fetchVisiblePins]);

  // Refresca cuando cambia el filtro de categoría
  useEffect(() => {
    void fetchVisiblePins();
  }, [activeCategory, fetchVisiblePins]);

  // Redibuja los pines de Leaflet cada vez que cambia el estado `pins`
  useEffect(() => {
    const layer = markersLayerRef.current;
    if (!layer) return;

    layer.clearLayers();

    for (const pin of pins) {
      const isMine = pin.reservedBy === user.id;
      const stateClass =
        pin.status === 'disponible'
          ? 'pin-available'
          : isMine
          ? 'pin-mine'
          : 'pin-reserved';

      const icon = L.divIcon({
        className: 'custom-pin-wrapper',
        html: `<div class="pin-bubble ${stateClass}">${CATEGORY_ICONS[pin.category]}</div>`,
        iconSize: [42, 42],
        iconAnchor: [21, 21],
      });

      const marker = L.marker([pin.lat, pin.lng], { icon });
      marker.on('click', () => {
        if (!pickingLocation) {
          setSelectedPinId(pin.id);
        }
      });
      marker.addTo(layer);
    }
  }, [pins, user.id, pickingLocation]);

  const handleLocateMe = () => {
    if (!navigator.geolocation) {
      showToast(t.gpsError, true);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const next = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setUserCoords(next);

        const map = mapRef.current;
        if (map) {
          map.flyTo([next.lat, next.lng], 16, { duration: 0.8 });
          if (userLocationMarkerRef.current) {
            userLocationMarkerRef.current.setLatLng([next.lat, next.lng]);
          } else {
            userLocationMarkerRef.current = L.circleMarker([next.lat, next.lng], {
              radius: 8,
              color: '#ffffff',
              weight: 3,
              fillColor: '#2563eb',
              fillOpacity: 1,
            }).addTo(map);
          }
        }
      },
      () => {
        showToast(t.gpsError, true);
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  const handleConfirmCrosshair = () => {
    const map = mapRef.current;
    if (!map) return;
    const center = map.getCenter();
    setPickingLocation(false);
    setPublishCoords({
      lat: Number(center.lat.toFixed(5)),
      lng: Number(center.lng.toFixed(5)),
    });
  };

  const selectedPin = pins.find((p) => p.id === selectedPinId) ?? null;

  return (
    <div className="map-shell">
      <div ref={mapContainerRef} className="leaflet-canvas" />

      {/* Barra superior flotante */}
      <header className="map-top-bar">
        <div className="top-row">
          <div className="live-pill">
            <span className={`live-dot ${sseConnected ? 'online' : 'offline'}`} />
            <span>{sseConnected ? t.liveConnected : t.liveReconnecting}</span>
          </div>

          <div className="top-actions">
            <button
              type="button"
              className="floating-chip"
              onClick={() => setLangMenuOpen((v) => !v)}
            >
              🌐 {locale.toUpperCase()}
            </button>
            <button
              type="button"
              className="floating-chip"
              onClick={() => void onLogout()}
              title={t.logout}
            >
              🚪 {t.logout}
            </button>
          </div>
        </div>

        {langMenuOpen && (
          <div className="floating-lang-popover">
            {LOCALE_OPTIONS.map((opt) => (
              <button
                key={opt.code}
                type="button"
                lang={opt.code}
                dir={opt.dir}
                className={`lang-option-btn ${locale === opt.code ? 'active' : ''}`}
                onClick={() => {
                  onLocaleChange(opt.code);
                  setLangMenuOpen(false);
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}

        {/* Carrusel horizontal táctil de categorías */}
        <div className="category-strip">
          <button
            type="button"
            className={`filter-chip ${activeCategory === null ? 'active' : ''}`}
            onClick={() => setActiveCategory(null)}
          >
            ✨ {t.allCategories}
          </button>
          {PIN_CATEGORY_LIST.map((cat) => (
            <button
              key={cat}
              type="button"
              className={`filter-chip ${activeCategory === cat ? 'active' : ''}`}
              onClick={() => setActiveCategory((curr) => (curr === cat ? null : cat))}
            >
              {CATEGORY_ICONS[cat]} {t.categories[cat]}
            </button>
          ))}
        </div>
      </header>

      {/* Aviso si el usuario aleja demasiado el zoom */}
      {zoomWarning && <div className="zoom-banner">🔍 {t.zoomInHint}</div>}

      {/* Mira central para elegir la esquina exacta del contenedor */}
      {pickingLocation && (
        <div className="center-crosshair" aria-hidden="true">
          <div className="crosshair-pin">📍</div>
        </div>
      )}

      {/* Notificaciones breves (Toast) */}
      {toast && (
        <div className={`toast-pill ${toast.isError ? 'toast-error' : ''}`} role="status">
          {toast.text}
        </div>
      )}

      {/* Controles inferiores (zona del pulgar) */}
      {pickingLocation ? (
        <div className="pick-confirm-bar">
          <p>{t.placeCrosshair}</p>
          <div className="pick-confirm-actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setPickingLocation(false)}
            >
              {t.cancel}
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={handleConfirmCrosshair}
            >
              ✓ {t.confirmLocation}
            </button>
          </div>
        </div>
      ) : (
        <div className="fab-cluster">
          <button
            type="button"
            className="fab-locate"
            onClick={handleLocateMe}
            aria-label={t.locateMe}
            title={t.locateMe}
          >
            🎯
          </button>
          <button
            type="button"
            className="fab-publish"
            onClick={() => {
              setSelectedPinId(null);
              setLangMenuOpen(false);
              setPickingLocation(true);
            }}
          >
            ＋ {t.quickPublish}
          </button>
        </div>
      )}

      {/* Bottom Sheet: Detalle del mueble */}
      {selectedPin && (
        <PinDetailSheet
          pin={selectedPin}
          currentUser={user}
          locale={locale}
          onClose={() => setSelectedPinId(null)}
          onPinUpdated={(updated) =>
            setPins((prev) =>
              prev.map((p) =>
                p.id === updated.id
                  ? { ...updated, distanceMeters: updated.distanceMeters ?? p.distanceMeters }
                  : p
              )
            )
          }
          onPinRemoved={(id) => setPins((prev) => prev.filter((p) => p.id !== id))}
          onNotify={showToast}
        />
      )}

      {/* Bottom Sheet: Publicación rápida con cámara */}
      {publishCoords && (
        <QuickPublishSheet
          coords={publishCoords}
          locale={locale}
          onClose={() => setPublishCoords(null)}
          onCreated={(created) =>
            setPins((prev) =>
              prev.some((p) => p.id === created.id) ? prev : [created, ...prev]
            )
          }
          onNotify={showToast}
        />
      )}
    </div>
  );
}