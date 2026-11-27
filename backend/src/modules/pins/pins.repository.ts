import { query, withTransaction } from '../../config/database';
import { PinCategory } from './pins.schema';

export type PinStatus = 'disponible' | 'reservado' | 'recogido' | 'expirado';

export interface PinSummaryRow {
  id: string;
  title: string;
  category: PinCategory;
  status: PinStatus;
  lat: number;
  lng: number;
  photo_url: string | null;
  distance_meters: number | null;
  created_by: string;
  reserved_by: string | null;
  reservation_expires_at: Date | null;
  expires_at: Date;
  created_at: Date;
}

export interface PinDetailRow extends PinSummaryRow {
  description: string | null;
  reserved_at: Date | null;
  collected_at: Date | null;
  creator_name: string;
}

export type ReservePinOutcome =
  | { status: 'not_found' }
  | { status: 'own_pin' }
  | { status: 'limit_reached' }
  | { status: 'not_available' }
  | { status: 'reserved'; pin: PinSummaryRow };

const EFFECTIVE_STATUS_SQL = `
  CASE
    WHEN p.status = 'reservado' AND p.reservation_expires_at <= NOW() THEN 'disponible'::pin_status
    ELSE p.status
  END
`;

const EFFECTIVE_RESERVED_BY_SQL = `
  CASE
    WHEN p.status = 'reservado' AND p.reservation_expires_at <= NOW() THEN NULL
    ELSE p.reserved_by
  END
`;

const EFFECTIVE_RES_EXPIRES_SQL = `
  CASE
    WHEN p.status = 'reservado' AND p.reservation_expires_at <= NOW() THEN NULL
    ELSE p.reservation_expires_at
  END
`;

export const pinsRepository = {
  async hasRecentDuplicateNear(
    userId: string,
    lng: number,
    lat: number,
    radiusMeters = 15
  ): Promise<boolean> {
    const res = await query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1
         FROM pins
         WHERE created_by = $1
           AND created_at > NOW() - INTERVAL '10 minutes'
           AND status IN ('disponible', 'reservado')
           AND ST_DWithin(
             location,
             ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography,
             $4
           )
       ) AS exists`,
      [userId, lng, lat, radiusMeters]
    );
    return res.rows[0].exists;
  },

  async create(params: {
    userId: string;
    title: string;
    description: string | null;
    category: PinCategory;
    lng: number;
    lat: number;
    photoUrl: string | null;
    ttlHours: number;
  }): Promise<PinSummaryRow> {
    const res = await query<PinSummaryRow>(
      `INSERT INTO pins (created_by, title, description, category, location, photo_url, expires_at)
       VALUES (
         $1,
         $2,
         $3,
         $4,
         ST_SetSRID(ST_MakePoint($5, $6), 4326)::geography,
         $7,
         NOW() + ($8 * INTERVAL '1 hour')
       )
       RETURNING
         id,
         title,
         category,
         status,
         ROUND(ST_Y(location::geometry)::numeric, 5)::float8 AS lat,
         ROUND(ST_X(location::geometry)::numeric, 5)::float8 AS lng,
         photo_url,
         NULL::float8 AS distance_meters,
         created_by,
         reserved_by,
         reservation_expires_at,
         expires_at,
         created_at`,
      [
        params.userId,
        params.title,
        params.description,
        params.category,
        params.lng,
        params.lat,
        params.photoUrl,
        params.ttlHours,
      ]
    );
    return res.rows[0];
  },

  async searchByRadius(params: {
    lng: number;
    lat: number;
    radiusMeters: number;
    category?: PinCategory;
    limit?: number;
  }): Promise<PinSummaryRow[]> {
    const values: unknown[] = [params.lng, params.lat, params.radiusMeters];
    let categoryClause = '';

    if (params.category) {
      values.push(params.category);
      categoryClause = `AND p.category = $${values.length}`;
    }

    values.push(params.limit ?? 100);
    const limitParam = `$${values.length}`;

    const res = await query<PinSummaryRow>(
      `SELECT
         p.id,
         p.title,
         p.category,
         ${EFFECTIVE_STATUS_SQL} AS status,
         ROUND(ST_Y(p.location::geometry)::numeric, 5)::float8 AS lat,
         ROUND(ST_X(p.location::geometry)::numeric, 5)::float8 AS lng,
         p.photo_url,
         ROUND(
           ST_Distance(
             p.location,
             ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
           )
         )::float8 AS distance_meters,
         p.created_by,
         ${EFFECTIVE_RESERVED_BY_SQL} AS reserved_by,
         ${EFFECTIVE_RES_EXPIRES_SQL} AS reservation_expires_at,
         p.expires_at,
         p.created_at
       FROM pins p
       WHERE p.status IN ('disponible', 'reservado')
         AND p.expires_at > NOW()
         AND ST_DWithin(
           p.location,
           ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
           $3
         )
         ${categoryClause}
       ORDER BY distance_meters ASC
       LIMIT ${limitParam}`,
      values
    );
    return res.rows;
  },

  async searchByBbox(params: {
    minLng: number;
    minLat: number;
    maxLng: number;
    maxLat: number;
    userLng?: number;
    userLat?: number;
    category?: PinCategory;
    limit?: number;
  }): Promise<PinSummaryRow[]> {
    const values: unknown[] = [params.minLng, params.minLat, params.maxLng, params.maxLat];

    let distanceSelect = 'NULL::float8 AS distance_meters';
    if (params.userLng !== undefined && params.userLat !== undefined) {
      values.push(params.userLng, params.userLat);
      const lngIdx = values.length - 1;
      const latIdx = values.length;
      distanceSelect = `ROUND(
        ST_Distance(
          p.location,
          ST_SetSRID(ST_MakePoint($${lngIdx}, $${latIdx}), 4326)::geography
        )
      )::float8 AS distance_meters`;
    }

    let categoryClause = '';
    if (params.category) {
      values.push(params.category);
      categoryClause = `AND p.category = $${values.length}`;
    }

    values.push(params.limit ?? 100);
    const limitParam = `$${values.length}`;

    // Castear el envelope a ::geography permite aprovechar el índice espacial GIST
    const res = await query<PinSummaryRow>(
      `SELECT
         p.id,
         p.title,
         p.category,
         ${EFFECTIVE_STATUS_SQL} AS status,
         ROUND(ST_Y(p.location::geometry)::numeric, 5)::float8 AS lat,
         ROUND(ST_X(p.location::geometry)::numeric, 5)::float8 AS lng,
         p.photo_url,
         ${distanceSelect},
         p.created_by,
         ${EFFECTIVE_RESERVED_BY_SQL} AS reserved_by,
         ${EFFECTIVE_RES_EXPIRES_SQL} AS reservation_expires_at,
         p.expires_at,
         p.created_at
       FROM pins p
       WHERE p.status IN ('disponible', 'reservado')
         AND p.expires_at > NOW()
         AND ST_Intersects(
           p.location,
           ST_MakeEnvelope($1, $2, $3, $4, 4326)::geography
         )
         ${categoryClause}
       ORDER BY p.created_at DESC
       LIMIT ${limitParam}`,
      values
    );
    return res.rows;
  },

  async findById(pinId: string): Promise<PinDetailRow | null> {
    const res = await query<PinDetailRow>(
      `SELECT
         p.id,
         p.title,
         p.description,
         p.category,
         ${EFFECTIVE_STATUS_SQL} AS status,
         ROUND(ST_Y(p.location::geometry)::numeric, 5)::float8 AS lat,
         ROUND(ST_X(p.location::geometry)::numeric, 5)::float8 AS lng,
         p.photo_url,
         NULL::float8 AS distance_meters,
         p.created_by,
         ${EFFECTIVE_RESERVED_BY_SQL} AS reserved_by,
         p.reserved_at,
         ${EFFECTIVE_RES_EXPIRES_SQL} AS reservation_expires_at,
         p.collected_at,
         p.expires_at,
         p.created_at,
         u.display_name AS creator_name
       FROM pins p
       JOIN users u ON u.id = p.created_by
       WHERE p.id = $1`,
      [pinId]
    );
    return res.rows[0] || null;
  },

  async reserveAtomic(params: {
    pinId: string;
    userId: string;
    reservationTtlHours: number;
    maxActiveReservations: number;
  }): Promise<ReservePinOutcome> {
    return withTransaction(async (client) => {
      // 1. Bloquea la fila del usuario para serializar reservas concurrentes de la misma cuenta
      await client.query(`SELECT id FROM users WHERE id = $1 FOR UPDATE`, [params.userId]);

      // 2. Comprueba existencia y propiedad del pin
      const pinCheck = await client.query<{ id: string; created_by: string }>(
        `SELECT id, created_by FROM pins WHERE id = $1`,
        [params.pinId]
      );
      if (pinCheck.rowCount === 0) {
        return { status: 'not_found' };
      }
      if (pinCheck.rows[0].created_by === params.userId) {
        return { status: 'own_pin' };
      }

      // 3. Cuenta solo reservas activas y aún vigentes del usuario
      const countRes = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM pins
         WHERE reserved_by = $1
           AND status = 'reservado'
           AND reservation_expires_at > NOW()
           AND expires_at > NOW()`,
        [params.userId]
      );
      if (Number(countRes.rows[0].count) >= params.maxActiveReservations) {
        return { status: 'limit_reached' };
      }

      // 4. UPDATE atómico condicional: solo reserva si sigue libre (o si la reserva previa venció)
      const updateRes = await client.query<PinSummaryRow>(
        `UPDATE pins
         SET status = 'reservado',
             reserved_by = $1,
             reserved_at = NOW(),
             reservation_expires_at = NOW() + ($2 * INTERVAL '1 hour')
         WHERE id = $3
           AND expires_at > NOW()
           AND (
             status = 'disponible'
             OR (status = 'reservado' AND reservation_expires_at <= NOW())
           )
         RETURNING
           id,
           title,
           category,
           status,
           ROUND(ST_Y(location::geometry)::numeric, 5)::float8 AS lat,
           ROUND(ST_X(location::geometry)::numeric, 5)::float8 AS lng,
           photo_url,
           NULL::float8 AS distance_meters,
           created_by,
           reserved_by,
           reservation_expires_at,
           expires_at,
           created_at`,
        [params.userId, params.reservationTtlHours, params.pinId]
      );

      if (updateRes.rowCount === 0) {
        return { status: 'not_available' };
      }

      return { status: 'reserved', pin: updateRes.rows[0] };
    });
  },

  async releaseReservation(
    pinId: string,
    userId: string,
    isAdmin: boolean
  ): Promise<PinSummaryRow | null> {
    const res = await query<PinSummaryRow>(
      `UPDATE pins
       SET status = 'disponible',
           reserved_by = NULL,
           reserved_at = NULL,
           reservation_expires_at = NULL
       WHERE id = $1
         AND status = 'reservado'
         AND expires_at > NOW()
         AND ($2::boolean = TRUE OR reserved_by = $3)
       RETURNING
         id,
         title,
         category,
         status,
         ROUND(ST_Y(location::geometry)::numeric, 5)::float8 AS lat,
         ROUND(ST_X(location::geometry)::numeric, 5)::float8 AS lng,
         photo_url,
         NULL::float8 AS distance_meters,
         created_by,
         reserved_by,
         reservation_expires_at,
         expires_at,
         created_at`,
      [pinId, isAdmin, userId]
    );
    return res.rows[0] || null;
  },

  async markCollected(
    pinId: string,
    userId: string,
    isAdmin: boolean
  ): Promise<PinSummaryRow | null> {
    const res = await query<PinSummaryRow>(
      `UPDATE pins
       SET status = 'recogido',
           collected_at = NOW()
       WHERE id = $1
         AND status IN ('disponible', 'reservado')
         AND expires_at > NOW()
         AND (
           $2::boolean = TRUE
           OR created_by = $3
           OR (status = 'reservado' AND reserved_by = $3)
         )
       RETURNING
         id,
         title,
         category,
         status,
         ROUND(ST_Y(location::geometry)::numeric, 5)::float8 AS lat,
         ROUND(ST_X(location::geometry)::numeric, 5)::float8 AS lng,
         photo_url,
         NULL::float8 AS distance_meters,
         created_by,
         reserved_by,
         reservation_expires_at,
         expires_at,
         created_at`,
      [pinId, isAdmin, userId]
    );
    return res.rows[0] || null;
  },

  async deletePin(pinId: string, userId: string, isAdmin: boolean): Promise<boolean> {
    const res = await query(
      `DELETE FROM pins
       WHERE id = $1
         AND ($2::boolean = TRUE OR (created_by = $3 AND status = 'disponible'))`,
      [pinId, isAdmin, userId]
    );
    return (res.rowCount ?? 0) > 0;
  },async releaseExpiredReservations(): Promise<PinSummaryRow[]> {
    const res = await query<PinSummaryRow>(
      `UPDATE pins
       SET status = 'disponible',
           reserved_by = NULL,
           reserved_at = NULL,
           reservation_expires_at = NULL
       WHERE status = 'reservado'
         AND reservation_expires_at <= NOW()
         AND expires_at > NOW()
       RETURNING
         id,
         title,
         category,
         status,
         ROUND(ST_Y(location::geometry)::numeric, 5)::float8 AS lat,
         ROUND(ST_X(location::geometry)::numeric, 5)::float8 AS lng,
         photo_url,
         NULL::float8 AS distance_meters,
         created_by,
         reserved_by,
         reservation_expires_at,
         expires_at,
         created_at`
    );
    return res.rows;
  },

  async expireOverduePins(): Promise<string[]> {
    const res = await query<{ id: string }>(
      `UPDATE pins
       SET status = 'expirado',
           reserved_by = NULL,
           reserved_at = NULL,
           reservation_expires_at = NULL
       WHERE status IN ('disponible', 'reservado')
         AND expires_at <= NOW()
       RETURNING id`
    );
    return res.rows.map((r) => r.id);
  },
};