import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api, closeTestPool, resetTestData } from './helpers';

const PREFIX = 'vitest-bcn-';
const PASS = 'TestPass123!';

async function registerAndLogin(suffix: string) {
  const email = `${PREFIX}${suffix}@ejemplo.com`;
  const res = await api()
    .post('/api/auth/register')
    .send({
      email,
      password: PASS,
      displayName: `Test ${suffix}`,
    });

  expect([200, 201]).toContain(res.status);
  const cookies = res.headers['set-cookie'];
  const cookieHeader = Array.isArray(cookies) ? cookies.join('; ') : (cookies ?? '');
  const accessToken = res.body?.data?.accessToken ?? res.body?.accessToken;
  expect(accessToken).toBeTruthy();

  return {
    email,
    accessToken: accessToken as string,
    cookieHeader,
  };
}

function extractPinId(body: any): string | undefined {
  return body?.data?.pin?.id ?? body?.data?.id ?? body?.pin?.id ?? body?.id;
}

function extractPinsList(body: any): Array<{ id: string }> {
  const list = body?.data?.pins ?? body?.data ?? body?.pins ?? body;
  return Array.isArray(list) ? list : [];
}

describe('Integración Backend: Auth, PostGIS y Reserva Atómica', () => {
  beforeAll(async () => {
    await resetTestData(PREFIX);
  });

  beforeEach(async () => {
    await resetTestData(PREFIX);
  });

  afterAll(async () => {
    await resetTestData(PREFIX);
    await closeTestPool();
  });

  it('responde OK en /api/health', async () => {
    const res = await api().get('/api/health');
    expect(res.status).toBe(200);
  });

  it('rota el refresh token y detecta reutilización de token revocado', async () => {
    const user = await registerAndLogin('auth');

    const firstRefresh = await api()
      .post('/api/auth/refresh')
      .set('Cookie', user.cookieHeader);

    expect(firstRefresh.status).toBe(200);
    const refreshedToken = firstRefresh.body?.data?.accessToken ?? firstRefresh.body?.accessToken;
    expect(refreshedToken).toBeTruthy();

    const rotatedCookies = firstRefresh.headers['set-cookie'];
    const rotatedCookieHeader = Array.isArray(rotatedCookies)
      ? rotatedCookies.join('; ')
      : (rotatedCookies ?? '');

    // Reutilizar el refresh token anterior debe ser rechazado por la rotación/detección
    const reuseAttempt = await api()
      .post('/api/auth/refresh')
      .set('Cookie', user.cookieHeader);

    expect([401, 403]).toContain(reuseAttempt.status);
    expect(rotatedCookieHeader).toBeTruthy();
  });

  it('crea un pin en Barcelona y lo encuentra en búsqueda por radio y bbox PostGIS', async () => {
    const user = await registerAndLogin('geo');

    // Coordenadas cerca de Plaça Catalunya / Eixample, Barcelona
    const createRes = await api()
      .post('/api/pins')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({
        category: 'silla',
        title: 'Silla de madera junto a contenedor',
        description: 'Buen estado general',
        lat: 41.3879,
        lng: 2.1699,
      });

    expect([200, 201]).toContain(createRes.status);
    const createdId = extractPinId(createRes.body);
    expect(createdId).toBeTruthy();

    // Búsqueda por radio de 500 m
    const radiusRes = await api()
      .get('/api/pins')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .query({ lat: 41.388, lng: 2.17, radius: 500 });

    expect(radiusRes.status).toBe(200);
    const itemsRadius = extractPinsList(radiusRes.body);
    expect(itemsRadius.some((p) => p.id === createdId)).toBe(true);

    // Búsqueda por bbox que incluye el punto
    const bboxRes = await api()
      .get('/api/pins')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .query({ minLat: 41.380, minLng: 2.160, maxLat: 41.395, maxLng: 2.180 });

    expect(bboxRes.status).toBe(200);
    const itemsBbox = extractPinsList(bboxRes.body);
    expect(itemsBbox.some((p) => p.id === createdId)).toBe(true);
  });

  it('evita doble reserva concurrente (FOR UPDATE): solo 1 usuario gana', async () => {
    const author = await registerAndLogin('author');
    const collectorA = await registerAndLogin('collector-a');
    const collectorB = await registerAndLogin('collector-b');

    const createRes = await api()
      .post('/api/pins')
      .set('Authorization', `Bearer ${author.accessToken}`)
      .send({
        category: 'sofa',
        title: 'Sofá de dos plazas',
        lat: 41.3917,
        lng: 2.1649,
      });

    expect([200, 201]).toContain(createRes.status);
    const pinId = extractPinId(createRes.body);
    expect(pinId).toBeTruthy();

    const [resA, resB] = await Promise.all([
      api()
        .post(`/api/pins/${pinId}/reserve`)
        .set('Authorization', `Bearer ${collectorA.accessToken}`),
      api()
        .post(`/api/pins/${pinId}/reserve`)
        .set('Authorization', `Bearer ${collectorB.accessToken}`),
    ]);
    const statuses = [resA.status, resB.status].sort();
    expect(statuses[0]).toBe(200);
    expect(statuses[1]).toBe(409);

  });
});