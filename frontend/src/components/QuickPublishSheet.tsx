import React, { useEffect, useState } from 'react';
import {
  CATEGORY_ICONS,
  Locale,
  PIN_CATEGORY_LIST,
  translations,
} from '../i18n/translations';
import { api } from '../services/api';
import { PinCategory, PinSummary } from '../types/api';
import { CompressedImage, compressMobilePhoto } from '../utils/imageCompressor';

interface QuickPublishSheetProps {
  coords: { lat: number; lng: number };
  locale: Locale;
  onClose: () => void;
  onCreated: (pin: PinSummary) => void;
  onNotify: (message: string, isError?: boolean) => void;
}

export function QuickPublishSheet({
  coords,
  locale,
  onClose,
  onCreated,
  onNotify,
}: QuickPublishSheetProps) {
  const t = translations[locale];

  const [category, setCategory] = useState<PinCategory>('sofa');
  const [description, setDescription] = useState('');
  const [photo, setPhoto] = useState<CompressedImage | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [compressing, setCompressing] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Libera la URL temporal de la foto de la memoria del teléfono al cerrar
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setCompressing(true);
    try {
      const compressed = await compressMobilePhoto(file);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPhoto(compressed);
      setPreviewUrl(URL.createObjectURL(compressed.blob));
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Error procesando foto', true);
    } finally {
      setCompressing(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      let photoUrl: string | undefined;
      if (photo) {
        photoUrl = await api.uploadPhoto(photo.blob, photo.contentType);
      }

      const created = await api.createPin({
        lat: coords.lat,
        lng: coords.lng,
        category,
        description: description.trim() || undefined,
        photoUrl,
      });

      onCreated(created);
      onNotify(t.pinCreatedToast);
      onClose();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Error al publicar', true);
    } finally {
      setSubmitting(false);
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
          <h2>{t.chooseCategory}</h2>
          <button
            type="button"
            className="icon-close-btn"
            onClick={onClose}
            aria-label={t.close}
          >
            ✕
          </button>
        </div>

        <form className="publish-form" onSubmit={handleSubmit}>
          <div className="category-grid">
            {PIN_CATEGORY_LIST.map((cat) => (
              <button
                key={cat}
                type="button"
                className={`category-tile ${category === cat ? 'selected' : ''}`}
                onClick={() => setCategory(cat)}
              >
                <span className="tile-emoji" aria-hidden="true">
                  {CATEGORY_ICONS[cat]}
                </span>
                <span className="tile-label">{t.categories[cat]}</span>
              </button>
            ))}
          </div>

          <div className="camera-row">
            <label className="camera-btn">
              <span>
                📷{' '}
                {compressing
                  ? t.compressingPhoto
                  : photo
                  ? `${t.changePhoto} (${Math.round(photo.sizeBytes / 1024)} KB)`
                  : t.takePhoto}
              </span>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => void handleFileChange(e)}
                disabled={compressing || submitting}
                hidden
              />
            </label>

            {previewUrl && (
              <img src={previewUrl} alt="Preview" className="camera-thumb" />
            )}
          </div>

          <label className="field">
            <span>{t.noteOptional}</span>
            <input
              type="text"
              maxLength={500}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t.notePlaceholder}
            />
          </label>

          <button
            type="submit"
            className="btn-primary action-full"
            disabled={submitting || compressing}
          >
            {submitting ? t.publishing : `📍 ${t.publishNow}`}
          </button>
        </form>
      </section>
    </div>
  );
}