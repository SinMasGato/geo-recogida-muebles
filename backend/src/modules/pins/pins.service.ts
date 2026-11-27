import { env } from '../../config/env';
import { AppError } from '../../utils/AppError';
import { AuthUserPayload } from '../../types/express';
import { auditRepository } from '../audit/audit.repository';
import { sseManager } from '../events/events.manager';
import { CATEGORY_DEFAULT_TITLES, CreatePinInput, SearchPinsInput } from './pins.schema';
import { PinDetailRow, PinSummaryRow, pinsRepository } from './pins.repository';
import { mediaService } from '../media/media.service';


function mapPinSummary(row: PinSummaryRow) {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    status: row.status,
    lat: row.lat,
    lng: row.lng,
    photoUrl: row.photo_url,
    distanceMeters: row.distance_meters,
    createdBy: row.created_by,
    reservedBy: row.reserved_by,
    reservationExpiresAt: row.reservation_expires_at,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

function mapPinDetail(row: PinDetailRow) {
  return {
    ...mapPinSummary(row),
    description: row.description,
    reservedAt: row.reserved_at,
    collectedAt: row.collected_at,
    creatorName: row.creator_name,
  };
}

export const pinsService = {
  async createQuickPin(user: AuthUserPayload, input: CreatePinInput, ip?: string) {
    const isDuplicate = await pinsRepository.hasRecentDuplicateNear(
      user.id,
      input.lng,
      input.lat,
      15
    );
    if (isDuplicate) {
      throw new AppError(
        'Ya publicaste un objeto en este mismo punto hace unos minutos.',
        409
      );
    }

    if (input.photoUrl) {
      await mediaService.assertValidUserPhotoUrl(user.id, input.photoUrl);
    }

    const title = input.title || CATEGORY_DEFAULT_TITLES[input.category];

    const created = await pinsRepository.create({
      userId: user.id,
      title,
      description: input.description ?? null,
      category: input.category,
      lng: input.lng,
      lat: input.lat,
      photoUrl: input.photoUrl ?? null,
      ttlHours: env.PIN_TTL_HOURS,
    });

    const dto = mapPinSummary(created);

    await auditRepository.log({
      actorId: user.id,
      action: 'PIN_CREATED',
      entityType: 'pin',
      entityId: dto.id,
      metadata: {
        category: dto.category,
        lat: dto.lat,
        lng: dto.lng,
        hasPhoto: Boolean(dto.photoUrl),
      },
      ipAddress: ip,
    });

    sseManager.broadcast('pin:created', { pin: dto });

    return dto;
  },

  async searchPins(input: SearchPinsInput) {
    const hasBbox =
      input.minLat !== undefined &&
      input.minLng !== undefined &&
      input.maxLat !== undefined &&
      input.maxLng !== undefined;

    if (hasBbox) {
      const rows = await pinsRepository.searchByBbox({
        minLng: input.minLng!,
        minLat: input.minLat!,
        maxLng: input.maxLng!,
        maxLat: input.maxLat!,
        userLng: input.lng,
        userLat: input.lat,
        category: input.category,
        limit: 100,
      });
      return rows.map(mapPinSummary);
    }

    // Fuerza el tope máximo de radio en backend (10 km por defecto en .env)
    const effectiveRadius = Math.min(
      input.radius ?? env.DEFAULT_SEARCH_RADIUS_METERS,
      env.MAX_SEARCH_RADIUS_METERS
    );

    const rows = await pinsRepository.searchByRadius({
      lng: input.lng!,
      lat: input.lat!,
      radiusMeters: effectiveRadius,
      category: input.category,
      limit: 100,
    });

    return rows.map(mapPinSummary);
  },

  async getPinDetail(pinId: string) {
    const pin = await pinsRepository.findById(pinId);
    if (!pin) {
      throw new AppError('Objeto no encontrado', 404);
    }
    return mapPinDetail(pin);
  },

  async reservePin(user: AuthUserPayload, pinId: string, ip?: string) {
    const outcome = await pinsRepository.reserveAtomic({
      pinId,
      userId: user.id,
      reservationTtlHours: env.RESERVATION_TTL_HOURS,
      maxActiveReservations: env.MAX_ACTIVE_RESERVATIONS_PER_USER,
    });

    if (outcome.status === 'not_found') {
      throw new AppError('Objeto no encontrado', 404);
    }
    if (outcome.status === 'own_pin') {
      throw new AppError('No puedes reservar un objeto que publicaste tú mismo', 400);
    }
    if (outcome.status === 'limit_reached') {
      throw new AppError(
        `Ya tienes el máximo de ${env.MAX_ACTIVE_RESERVATIONS_PER_USER} reservas activas`,
        409
      );
    }
    if (outcome.status === 'not_available') {
      throw new AppError('Este objeto ya fue reservado, recogido o ha expirado', 409);
    }

    const dto = mapPinSummary(outcome.pin);

    await auditRepository.log({
      actorId: user.id,
      action: 'PIN_RESERVED',
      entityType: 'pin',
      entityId: dto.id,
      metadata: { reservationExpiresAt: dto.reservationExpiresAt },
      ipAddress: ip,
    });

    sseManager.broadcast('pin:updated', { pin: dto });

    return dto;
  },

  async releaseReservation(user: AuthUserPayload, pinId: string, ip?: string) {
    const released = await pinsRepository.releaseReservation(
      pinId,
      user.id,
      user.role === 'admin'
    );
    if (!released) {
      throw new AppError(
        'No se pudo liberar la reserva (no existe, ya venció o no te pertenece)',
        409
      );
    }

    const dto = mapPinSummary(released);

    await auditRepository.log({
      actorId: user.id,
      action: 'PIN_RELEASED',
      entityType: 'pin',
      entityId: dto.id,
      ipAddress: ip,
    });

    sseManager.broadcast('pin:updated', { pin: dto });

    return dto;
  },

  async markCollected(user: AuthUserPayload, pinId: string, ip?: string) {
    const collected = await pinsRepository.markCollected(
      pinId,
      user.id,
      user.role === 'admin'
    );
    if (!collected) {
      throw new AppError(
        'No se pudo marcar como recogido (verifica que siga activo y tengas permiso)',
        409
      );
    }

    const dto = mapPinSummary(collected);

    await auditRepository.log({
      actorId: user.id,
      action: 'PIN_COLLECTED',
      entityType: 'pin',
      entityId: dto.id,
      ipAddress: ip,
    });

    sseManager.broadcast('pin:deleted', { pinId: dto.id, reason: 'recogido' });

    return dto;
  },

  async deletePin(user: AuthUserPayload, pinId: string, ip?: string) {
    const deleted = await pinsRepository.deletePin(pinId, user.id, user.role === 'admin');
    if (!deleted) {
      throw new AppError(
        'No se pudo eliminar el objeto (solo el autor puede borrarlo si sigue disponible)',
        403
      );
    }

    await auditRepository.log({
      actorId: user.id,
      action: 'PIN_DELETED',
      entityType: 'pin',
      entityId: pinId,
      ipAddress: ip,
    });

    sseManager.broadcast('pin:deleted', { pinId, reason: 'eliminado' });
  },
};