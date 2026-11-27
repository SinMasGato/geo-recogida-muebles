import { useEffect, useState } from 'react';
import { CATEGORY_ICONS, Locale, translations } from '../i18n/translations';
import { api, resolveMediaUrl } from '../services/api';
import { PinDetail, PinSummary, User } from '../types/api';

interface PinDetailSheetProps {
  pin: PinSummary;
  currentUser: User;
  locale: Locale;
  onClose: () => void;
  onPinUpdated: (updated: PinSummary) => void;
  onPinRemoved: (pinId: string) => void;
  onNotify: (message: string, isError?: boolean) => void;
}

function formatDistance(meters: number | null): string | null {
  if (meters === null) return null;
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

function formatHour(iso: string | null, locale: Locale): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function PinDetailSheet({
  pin,
  currentUser,
  locale,
  onClose,
  onPinUpdated,
  onPinRemoved,
  onNotify,
}: PinDetailSheetProps) {
  const t = translations[locale];
  const [detail, setDetail] = useState<PinDetail | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setDetail(null);
    api
      .getPinDetail(pin.id)
      .then((data) => {
        if (active) setDetail(data);
      })
      .catch(() => {
        // Mantiene la vista con los datos del resumen si falla el detalle
      });
    return () => {
      active = false;
    };
  }, [pin.id]);

  const isCreator = pin.createdBy === currentUser.id;
  const isReserver = pin.reservedBy === currentUser.id;
  const isAdmin = currentUser.role === 'admin';

  const canReserve = pin.status === 'disponible' && !isCreator;
  const canRelease = pin.status === 'reservado' && (isReserver || isAdmin);
  const canCollect =
    (pin.status === 'disponible' && (isCreator || isAdmin)) ||
    (pin.status === 'reservado' && (isReserver || isCreator || isAdmin));
  const canDelete = (pin.status === 'disponible' && isCreator) || isAdmin;

  const photoSrc = resolveMediaUrl(pin.photoUrl);
  const distanceLabel = formatDistance(pin.distanceMeters);
  const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${pin.lat},${pin.lng}&travelmode=walking`;

  const runAction = async (
    actionKey: string,
    fn: () => Promise<void>
  ) => {
    setBusyAction(actionKey);
    try {
      await fn();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Error', true);
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <section
        className="bottom-sheet"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-handle" />

        <div className="sheet-header">
          <div className="sheet-title-wrap">
            <span className="sheet-emoji" aria-hidden="true">
              {CATEGORY_ICONS[pin.category]}
            </span>
            <div>
              <h2>{t.categories[pin.category]}</h2>
              <div className="badge-row">
                <span className={`status-badge status-${pin.status}`}>
                  {pin.status === 'disponible'
                    ? t.statusAvailable
                    : isReserver
                    ? t.reservedByYou
                    : t.statusReserved}
                </span>
                {distanceLabel && <span className="meta-pill">📍 {distanceLabel}</span>}
              </div>
            </div>
          </div>

          <button
            type="button"
            className="icon-close-btn"
            onClick={onClose}
            aria-label={t.close}
          >
            ✕
          </button>
        </div>

        {photoSrc && (
          <div className="pin-photo-wrap">
            <img src={photoSrc} alt={pin.title} className="pin-photo" loading="lazy" />
          </div>
        )}

        <div className="sheet-body">
          <p className="pin-description">
            {detail?.description ? detail.description : t.noDescription}
          </p>

          <div className="pin-meta-grid">
            {detail?.creatorName && (
              <span>
                👤 {t.postedBy}: <strong>{detail.creatorName}</strong>
              </span>
            )}
            <span>
              ⏱️ {t.expiresAt}: <strong>{formatHour(pin.expiresAt, locale)}</strong>
            </span>
            {pin.status === 'reservado' && pin.reservationExpiresAt && (
              <span>
                🔒 {t.reservationUntil}:{' '}
                <strong>{formatHour(pin.reservationExpiresAt, locale)}</strong>
              </span>
            )}
          </div>
        </div>

        <div className="sheet-actions">
          <a
            href={mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary action-full"
          >
            🧭 {t.navigate}
          </a>

          {canReserve && (
            <button
              type="button"
              className="btn-primary action-full"
              disabled={busyAction !== null}
              onClick={() =>
                void runAction('reserve', async () => {
                  const updated = await api.reservePin(pin.id);
                  onPinUpdated(updated);
                  onNotify(t.pinReservedToast);
                })
              }
            >
              {busyAction === 'reserve' ? '...' : `🔒 ${t.reserve}`}
            </button>
          )}

          {canCollect && (
            <button
              type="button"
              className="btn-primary action-full"
              disabled={busyAction !== null}
              onClick={() =>
                void runAction('collect', async () => {
                  await api.collectPin(pin.id);
                  onPinRemoved(pin.id);
                  onNotify(t.pinCollectedToast);
                  onClose();
                })
              }
            >
              {busyAction === 'collect' ? '...' : `✅ ${t.collect}`}
            </button>
          )}

          <div className="action-row-split">
            {canRelease && (
              <button
                type="button"
                className="btn-secondary"
                disabled={busyAction !== null}
                onClick={() =>
                  void runAction('release', async () => {
                    const updated = await api.releasePin(pin.id);
                    onPinUpdated(updated);
                    onNotify(t.pinReleasedToast);
                  })
                }
              >
                {busyAction === 'release' ? '...' : t.release}
              </button>
            )}

            {canDelete && (
              <button
                type="button"
                className="btn-danger"
                disabled={busyAction !== null}
                onClick={() =>
                  void runAction('delete', async () => {
                    await api.deletePin(pin.id);
                    onPinRemoved(pin.id);
                    onNotify(t.pinDeletedToast);
                    onClose();
                  })
                }
              >
                {busyAction === 'delete' ? '...' : `🗑️ ${t.deletePin}`}
              </button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}