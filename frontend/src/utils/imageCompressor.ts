export interface CompressedImage {
  blob: Blob;
  contentType: 'image/webp' | 'image/jpeg';
  sizeBytes: number;
}

export async function compressMobilePhoto(
  file: File,
  maxDimension = 1280,
  quality = 0.78
): Promise<CompressedImage> {
  const objectUrl = URL.createObjectURL(file);

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('No se pudo leer la imagen seleccionada'));
      image.src = objectUrl;
    });

    let { width, height } = img;
    if (width > maxDimension || height > maxDimension) {
      const ratio = Math.min(maxDimension / width, maxDimension / height);
      width = Math.round(width * ratio);
      height = Math.round(height * ratio);
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No se pudo inicializar el compresor de imagen');

    // Al pintar en canvas se eliminan automáticamente todos los metadatos EXIF
    ctx.drawImage(img, 0, 0, width, height);

    const toBlob = (mime: 'image/webp' | 'image/jpeg') =>
      new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, quality));

    // Intenta WebP primero (más ligero); cae a JPEG si el navegador móvil no codifica WebP
    let blob = await toBlob('image/webp');
    let contentType: 'image/webp' | 'image/jpeg' = 'image/webp';

    if (!blob || blob.type !== 'image/webp') {
      blob = await toBlob('image/jpeg');
      contentType = 'image/jpeg';
    }

    if (!blob) throw new Error('Error al comprimir la fotografía');

    return {
      blob,
      contentType,
      sizeBytes: blob.size,
    };
  } finally {
    // Libera la memoria RAM del teléfono inmediatamente
    URL.revokeObjectURL(objectUrl);
  }
}