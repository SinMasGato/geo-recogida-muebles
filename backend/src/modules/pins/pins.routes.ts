import { Router } from 'express';
import { authenticate } from '../../middlewares/auth';
import { userWriteLimiter } from '../../middlewares/security';
import { pinsController } from './pins.controller';

const router = Router();

// Todas las rutas exigen cuenta registrada (regla de negocio definida)
router.use(authenticate);

router.get('/', pinsController.search);
router.get('/:id', pinsController.detail);

// Acciones de escritura protegidas por userWriteLimiter (CGNAT-safe)
router.post('/', userWriteLimiter, pinsController.create);
router.post('/:id/reserve', userWriteLimiter, pinsController.reserve);
router.post('/:id/release', userWriteLimiter, pinsController.release);
router.post('/:id/collect', userWriteLimiter, pinsController.collect);
router.delete('/:id', userWriteLimiter, pinsController.remove);

export default router;