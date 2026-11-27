import { Router } from 'express';
import { authenticate } from '../../middlewares/auth';
import { authLimiter } from '../../middlewares/security';
import { authController } from './auth.controller';

const router = Router();

router.post('/register', authLimiter, authController.register);
router.post('/login', authLimiter, authController.login);
router.post('/refresh', authLimiter, authController.refresh);
router.post('/logout', authController.logout);
router.get('/me', authenticate, authController.me);

export default router;