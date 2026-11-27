import { env } from '../config/env';
import { authRepository } from '../modules/auth/auth.repository';
import { sseManager } from '../modules/events/events.manager';
import { pinsRepository } from '../modules/pins/pins.repository';

class CleanupWorker {
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;

  start(): void {
    if (this.timer) return;

    const intervalMs = env.CLEANUP_INTERVAL_SECONDS * 1000;
    console.log(`🧹 Worker de limpieza TTL activo (cada ${env.CLEANUP_INTERVAL_SECONDS}s)`);

    // Ejecuta una pasada inicial al arrancar y luego periódicamente
    void this.runCycle();
    this.timer = setInterval(() => {
      void this.runCycle();
    }, intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async runCycle(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    try {
      // 1. Liberar reservas vencidas (> 2h) y avisar a los mapas móviles en vivo
      const releasedPins = await pinsRepository.releaseExpiredReservations();
      for (const pin of releasedPins) {
        sseManager.broadcast('pin:updated', {
          pin: {
            id: pin.id,
            title: pin.title,
            category: pin.category,
            status: pin.status,
            lat: pin.lat,
            lng: pin.lng,
            photoUrl: pin.photo_url,
            distanceMeters: null,
            createdBy: pin.created_by,
            reservedBy: pin.reserved_by,
            reservationExpiresAt: pin.reservation_expires_at,
            expiresAt: pin.expires_at,
            createdAt: pin.created_at,
          },
        });
      }

      // 2. Expirar pines que superaron las 24h y retirarlos del mapa por SSE
      const expiredIds = await pinsRepository.expireOverduePins();
      for (const pinId of expiredIds) {
        sseManager.broadcast('pin:deleted', { pinId, reason: 'expirado' });
      }

      // 3. Purgar refresh tokens viejos (> 30 días)
      const purgedTokens = await authRepository.purgeExpiredTokens(30);

      if (releasedPins.length > 0 || expiredIds.length > 0 || purgedTokens > 0) {
        console.log(
          `🧹 Limpieza TTL -> reservas liberadas: ${releasedPins.length}, pines expirados: ${expiredIds.length}, tokens purgados: ${purgedTokens}`
        );
      }
    } catch (error) {
      console.error('❌ Error en ciclo de limpieza TTL:', error);
    } finally {
      this.isRunning = false;
    }
  }
}

export const cleanupWorker = new CleanupWorker();