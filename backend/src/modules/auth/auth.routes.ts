import { Router, type RequestHandler } from 'express';
import { parse } from '../../http/validate.js';
import type { AuthService } from './auth.service.js';
import { loginBody, registerBody, staffRegisterBody } from './schemas.js';

export function authRouter(auth: AuthService, authenticate: RequestHandler): Router {
  const router = Router();

  router.post('/register', async (req, res) => {
    const user = await auth.register(parse(registerBody, req.body));
    res.status(201).json({ user });
  });

  router.post('/register-staff', async (req, res) => {
    const user = await auth.registerStaff(parse(staffRegisterBody, req.body), req.ip ?? 'unknown');
    res.status(201).json({ user });
  });

  router.post('/login', async (req, res) => {
    res.json(await auth.login(parse(loginBody, req.body), req.ip ?? 'unknown'));
  });

  router.post('/logout', authenticate, async (req, res) => {
    if (req.auth) await auth.logout(req.auth);
    res.status(204).end();
  });

  router.get('/me', authenticate, (req, res) => {
    const me = req.auth;
    res.json({
      user: me && { id: me.userId, email: me.email, display_name: me.displayName, role: me.role },
    });
  });

  return router;
}
