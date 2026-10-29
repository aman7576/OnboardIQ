import { Router } from 'express';
import { APP_VERSION } from '../../config/version.js';

export interface HealthDeps {
  environment: string;
  pingDb: () => Promise<void>;
}

export function healthRouter({ environment, pingDb }: HealthDeps): Router {
  const router = Router();

  // Liveness: the process is up. Does not touch the database.
  router.get('/', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'onboardiq-api',
      version: APP_VERSION,
      environment,
      time: new Date().toISOString(),
    });
  });

  // Readiness: PostgreSQL answers. 503 so load balancers / compose stop routing traffic.
  router.get('/db', async (_req, res) => {
    const started = performance.now();
    try {
      await pingDb();
      res.json({
        status: 'ok',
        database: 'up',
        latencyMs: Math.round(performance.now() - started),
      });
    } catch (err) {
      console.error('[health] database check failed:', err instanceof Error ? err.message : err);
      // Never echo the driver error: it can contain host names or credentials.
      res.status(503).json({ status: 'error', database: 'down', message: 'Database unreachable' });
    }
  });

  return router;
}
