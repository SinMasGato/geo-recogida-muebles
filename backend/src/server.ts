import app from './app';
import { env } from './config/env';
import { pool, verifyDatabaseConnection } from './config/database';
import { sseManager } from './modules/events/events.manager';
import { cleanupWorker } from './workers/cleanup.worker';

async function bootstrap(): Promise<void> {
  try {
    await verifyDatabaseConnection();
    cleanupWorker.start();

    const server = app.listen(env.PORT, () => {
      console.log(`🚀 Servidor API escuchando en http://localhost:${env.PORT}`);
    });

    const shutdown = async (signal: string) => {
      console.log(`\n🛑 Recibida señal ${signal}. Cerrando servidor...`);
      cleanupWorker.stop();
      sseManager.closeAll();
      server.close(async () => {
        await pool.end();
        console.log('✅ Conexiones cerradas limpiamente.');
        process.exit(0);
      });
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  } catch (error) {
    console.error('❌ No se pudo iniciar el servidor:', error);
    process.exit(1);
  }
}

bootstrap();