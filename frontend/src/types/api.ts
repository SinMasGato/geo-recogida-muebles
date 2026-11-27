export type UserRole = 'user' | 'admin';

export interface User {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  createdAt?: string;
}

export type PinCategory =
  | 'sofa'
  | 'silla'
  | 'mesa'
  | 'armario'
  | 'cama'
  | 'estanteria'
  | 'electrodomestico'
  | 'decoracion'
  | 'otros';

export type PinStatus = 'disponible' | 'reservado' | 'recogido' | 'expirado';

export interface PinSummary {
  id: string;
  title: string;
  category: PinCategory;
  status: PinStatus;
  lat: number;
  lng: number;
  photoUrl: string | null;
  distanceMeters: number | null;
  createdBy: string;
  reservedBy: string | null;
  reservationExpiresAt: string | null;
  expiresAt: string;
  createdAt: string;
}

export interface PinDetail extends PinSummary {
  description: string | null;
  reservedAt: string | null;
  collectedAt: string | null;
  creatorName: string;
}