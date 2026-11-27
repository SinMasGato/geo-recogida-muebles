import { z } from 'zod';

export const PIN_CATEGORIES = [
  'sofa',
  'silla',
  'mesa',
  'armario',
  'cama',
  'estanteria',
  'electrodomestico',
  'decoracion',
  'otros',
] as const;

export type PinCategory = (typeof PIN_CATEGORIES)[number];

export const CATEGORY_DEFAULT_TITLES: Record<PinCategory, string> = {
  sofa: 'Sofá disponible',
  silla: 'Silla / sillón disponible',
  mesa: 'Mesa disponible',
  armario: 'Armario / cómoda disponible',
  cama: 'Cama / somier disponible',
  estanteria: 'Estantería disponible',
  electrodomestico: 'Electrodoméstico disponible',
  decoracion: 'Objeto de decoración disponible',
  otros: 'Mueble / objeto disponible',
};

export const createPinSchema = z
  .object({
    lat: z.number().min(-90, 'Latitud mínima -90').max(90, 'Latitud máxima 90'),
    lng: z.number().min(-180, 'Longitud mínima -180').max(180, 'Longitud máxima 180'),
    category: z.enum(PIN_CATEGORIES),
    title: z.string().trim().min(2).max(120).optional(),
    description: z.string().trim().max(500).optional(),
    photoUrl: z.string().url('URL de foto inválida').max(500).optional(),
  })
  .strict();

export const pinIdParamSchema = z.object({
  id: z.string().uuid('Identificador de pin inválido'),
});

export const searchPinsSchema = z
  .object({
    // Modo 1: búsqueda por radio alrededor del usuario
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
    radius: z.coerce.number().int().min(100).optional(),

    // Modo 2: búsqueda por rectángulo visible en pantalla móvil (bbox)
    minLat: z.coerce.number().min(-90).max(90).optional(),
    minLng: z.coerce.number().min(-180).max(180).optional(),
    maxLat: z.coerce.number().min(-90).max(90).optional(),
    maxLng: z.coerce.number().min(-180).max(180).optional(),

    category: z.enum(PIN_CATEGORIES).optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    const hasRadiusMode = data.lat !== undefined && data.lng !== undefined;
    const hasBboxMode =
      data.minLat !== undefined &&
      data.minLng !== undefined &&
      data.maxLat !== undefined &&
      data.maxLng !== undefined;

    if (!hasRadiusMode && !hasBboxMode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Debes indicar (lat y lng) o el rectángulo del mapa (minLat, minLng, maxLat, maxLng)',
      });
      return;
    }

    if (hasBboxMode) {
      if (data.minLat! >= data.maxLat! || data.minLng! >= data.maxLng!) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'El rectángulo del mapa (bbox) tiene coordenadas invertidas',
        });
      }
      // Anti-scraping: limita el recuadro máximo a ~30 km de lado
      if (data.maxLat! - data.minLat! > 0.3 || data.maxLng! - data.minLng! > 0.3) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Acerca un poco más el mapa para ver los muebles de la zona',
        });
      }
    }
  });

export type CreatePinInput = z.infer<typeof createPinSchema>;
export type SearchPinsInput = z.infer<typeof searchPinsSchema>;