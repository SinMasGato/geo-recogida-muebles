import { Router } from 'express';
import { authenticate } from '../../middlewares/auth';
import { eventsController } from './events.controller';

const router = Router();

router.post('/ticket', authenticate, eventsController.createTicket);
router.get('/stream', eventsController.stream);

export default router;