import { PinCategory, PinDetail, PinSummary, User } from '../types/api';

let accessToken: string | null = null;
let refreshInFlight: Promise<boolean> | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function resolveMediaUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.pathname.startsWith('/uploads/')) {
      return parsed.pathname;
    }
    return url;
  } catch {
    return url;
  }
}

export class ApiClientError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
  }
}

async function performSilentRefresh(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        accessToken = null;
        return false;
      }
      const json = await res.json();
      accessToken = json.data.accessToken as string;
      return true;
    } catch {
      accessToken = null;
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  retryOnUnauthorized = true
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof Blob) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }

  const res = await fetch(path, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (res.status === 401 && retryOnUnauthorized && !path.startsWith('/api/auth/')) {
    const refreshed = await performSilentRefresh();
    if (refreshed) {
      return request<T>(path, options, false);
    }
  }

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = Array.isArray(json.errors) && json.errors[0]?.message
      ? json.errors[0].message
      : json.message || 'Error de conexión con el servidor';
    throw new ApiClientError(detail, res.status);
  }

  return json as T;
}

export const api = {
  // --- Auth ---
  async restoreSession(): Promise<User | null> {
    const ok = await performSilentRefresh();
    if (!ok) return null;
    try {
      const res = await request<{ data: { user: User } }>('/api/auth/me', { method: 'GET' }, false);
      return res.data.user;
    } catch {
      accessToken = null;
      return null;
    }
  },

  async login(email: string, password: string): Promise<User> {
    const res = await request<{ data: { user: User; accessToken: string } }>(
      '/api/auth/login',
      {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      },
      false
    );
    accessToken = res.data.accessToken;
    return res.data.user;
  },

  async register(email: string, password: string, displayName: string): Promise<User> {
    const res = await request<{ data: { user: User; accessToken: string } }>(
      '/api/auth/register',
      {
        method: 'POST',
        body: JSON.stringify({ email, password, displayName }),
      },
      false
    );
    accessToken = res.data.accessToken;
    return res.data.user;
  },

  async logout(): Promise<void> {
    try {
      await request('/api/auth/logout', { method: 'POST' }, false);
    } finally {
      accessToken = null;
    }
  },

  // --- SSE ---
  async getSseTicket(): Promise<{ ticket: string; expiresInSeconds: number }> {
    const res = await request<{ data: { ticket: string; expiresInSeconds: number } }>(
      '/api/events/ticket',
      { method: 'POST' }
    );
    return res.data;
  },

  // --- Media ---
  async uploadPhoto(blob: Blob, contentType: 'image/webp' | 'image/jpeg'): Promise<string> {
    const presign = await request<{
      data: { uploadUrl: string; photoUrl: string };
    }>('/api/media/presign', {
      method: 'POST',
      body: JSON.stringify({ contentType, sizeBytes: blob.size }),
    });

    // Extrae la ruta relativa (/api/media/upload/...) para pasar por el proxy de Vite
    const uploadPath = new URL(presign.data.uploadUrl).pathname;
    const putRes = await fetch(uploadPath, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body: blob,
      credentials: 'include',
    });

    if (!putRes.ok) {
      const errJson = await putRes.json().catch(() => ({}));
      throw new ApiClientError(errJson.message || 'Error al subir la fotografía', putRes.status);
    }

    return presign.data.photoUrl;
  },

  // --- Pins Geoespaciales ---
  async searchPinsByBbox(params: {
    minLat: number;
    minLng: number;
    maxLat: number;
    maxLng: number;
    lat?: number;
    lng?: number;
    category?: PinCategory;
  }): Promise<PinSummary[]> {
    const qs = new URLSearchParams({
      minLat: String(params.minLat),
      minLng: String(params.minLng),
      maxLat: String(params.maxLat),
      maxLng: String(params.maxLng),
    });
    if (params.lat !== undefined && params.lng !== undefined) {
      qs.set('lat', String(params.lat));
      qs.set('lng', String(params.lng));
    }
    if (params.category) qs.set('category', params.category);

    const res = await request<{ data: { pins: PinSummary[] } }>(`/api/pins?${qs.toString()}`);
    return res.data.pins;
  },

  async searchPinsByRadius(params: {
    lat: number;
    lng: number;
    radius?: number;
    category?: PinCategory;
  }): Promise<PinSummary[]> {
    const qs = new URLSearchParams({
      lat: String(params.lat),
      lng: String(params.lng),
    });
    if (params.radius) qs.set('radius', String(params.radius));
    if (params.category) qs.set('category', params.category);

    const res = await request<{ data: { pins: PinSummary[] } }>(`/api/pins?${qs.toString()}`);
    return res.data.pins;
  },

  async getPinDetail(id: string): Promise<PinDetail> {
    const res = await request<{ data: { pin: PinDetail } }>(`/api/pins/${id}`);
    return res.data.pin;
  },

  async createPin(payload: {
    lat: number;
    lng: number;
    category: PinCategory;
    title?: string;
    description?: string;
    photoUrl?: string;
  }): Promise<PinSummary> {
    const res = await request<{ data: { pin: PinSummary } }>('/api/pins', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return res.data.pin;
  },

  async reservePin(id: string): Promise<PinSummary> {
    const res = await request<{ data: { pin: PinSummary } }>(`/api/pins/${id}/reserve`, {
      method: 'POST',
    });
    return res.data.pin;
  },

  async releasePin(id: string): Promise<PinSummary> {
    const res = await request<{ data: { pin: PinSummary } }>(`/api/pins/${id}/release`, {
      method: 'POST',
    });
    return res.data.pin;
  },

  async collectPin(id: string): Promise<PinSummary> {
    const res = await request<{ data: { pin: PinSummary } }>(`/api/pins/${id}/collect`, {
      method: 'POST',
    });
    return res.data.pin;
  },

  async deletePin(id: string): Promise<void> {
    await request(`/api/pins/${id}`, { method: 'DELETE' });
  },
};