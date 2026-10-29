import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { errorHandler, routeNotFound } from '../../src/http/error-handler.js';
import { healthRouter } from '../../src/modules/health/health.routes.js';

const up = () => Promise.resolve();
const down = () =>
  Promise.reject(new Error('connect ECONNREFUSED postgresql://admin:s3cret@db:5432'));

// The health router on its own: no database needed.
const appWith = (pingDb: () => Promise<void>) => {
  const app = express();
  app.use('/api/v1/health', healthRouter({ environment: 'test', pingDb }));
  app.use(routeNotFound);
  app.use(errorHandler);
  return app;
};

describe('GET /api/v1/health', () => {
  it('returns 200 with service status', async () => {
    const res = await request(appWith(up)).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', service: 'onboardiq-api', environment: 'test' });
    expect(typeof res.body.version).toBe('string');
  });

  it('does not depend on the database', async () => {
    expect((await request(appWith(down)).get('/api/v1/health')).status).toBe(200);
  });
});

describe('GET /api/v1/health/db', () => {
  it('returns 200 when the database answers', async () => {
    const res = await request(appWith(up)).get('/api/v1/health/db');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', database: 'up' });
  });

  it('returns 503 without leaking the driver error when the database is down', async () => {
    const res = await request(appWith(down)).get('/api/v1/health/db');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      status: 'error',
      database: 'down',
      message: 'Database unreachable',
    });
    expect(JSON.stringify(res.body)).not.toContain('s3cret');
  });
});

describe('unknown routes', () => {
  it('return a JSON 404', async () => {
    const res = await request(appWith(up)).get('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('NOT_FOUND');
  });
});
