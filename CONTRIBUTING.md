# Guía de contribución

Gracias por tu interés en mejorar **ReMueble**. Este proyecto sigue un flujo de trabajo ordenado para mantener la rama `main` siempre estable y desplegable.

## 1. Flujo de ramas

Nunca realices commits directamente sobre `main`. Crea siempre una rama descriptiva desde `main`:

- `feat/<nombre>` — Nueva funcionalidad (ej. `feat/s3-media-storage`)
- `fix/<nombre>` — Corrección de error (ej. `fix/sse-reconnect-ios`)
- `docs/<nombre>` — Documentación (ej. `docs/api-examples`)
- `refactor/<nombre>` — Mejora interna sin cambiar comportamiento
- `chore/<nombre>` — Mantenimiento, dependencias o CI

## 2. Convención de commits (Conventional Commits)

Escribe mensajes claros en inglés o español siguiendo el formato `<tipo>: <resumen>`:

- `feat: add Cloudflare R2 adapter for presigned uploads`
- `fix: prevent duplicate pin requests on rapid map panning`
- `docs: update local Docker setup instructions`
- `test: add atomic reservation concurrency test`

## 3. Verificaciones obligatorias antes de abrir una Pull Request

Asegúrate de que ambos paquetes pasan el chequeo estricto de TypeScript y compilan sin errores:

```bash
# Backend
cd backend
npm run typecheck
npm run build

# Frontend
cd ../frontend
npm run typecheck
npm run build