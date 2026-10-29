import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { redactSecrets } from '../../src/http/redact.js';
import { requestLogger } from '../../src/http/request-log.js';

describe('redactSecrets', () => {
  it('hides database passwords, bearer tokens, session tokens and password fields', () => {
    const text = [
      'connect postgresql://onboardiq:Sup3rSecret@db:5432/onboardiq failed',
      'Authorization: Bearer oiq_abcdefghijklmnopqrstuvwxyz0123456789ABCDE',
      'token oiq_abcdefghijklmnopqrstuvwxyz0123456789ABCDE',
      '{"password":"Correct-Horse-9","email":"a@b.c"}',
      'x-service-key: test-service-key-0123456789',
    ].join('\n');
    const out = redactSecrets(text);
    for (const secret of [
      'Sup3rSecret',
      'abcdefghijklmnopqrstuvwxyz',
      'Correct-Horse-9',
      'test-service-key-0123456789',
    ])
      expect(out).not.toContain(secret);
    expect(out).toContain('a@b.c'); // ordinary data is left alone
  });
});

describe('request logger', () => {
  it('logs method, path and status only: no body, query, headers or response', async () => {
    const lines: string[] = [];
    const app = express();
    app.use(express.json());
    app.use(requestLogger((l) => lines.push(l)));
    const inner = express.Router();
    inner.post('/login', (_req, res) => res.json({ token: 'oiq_response_token_value_0123456789' }));
    app.use('/api/v1/auth', inner); // mounted, like the real routers

    await request(app)
      .post('/api/v1/auth/login?pan=ZZKPS1234Q')
      .set('Authorization', 'Bearer oiq_header_token_value_0123456789')
      .send({ password: 'Correct-Horse-9', text: 'full document text' });

    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0] as string) as Record<string, unknown>;
    expect(entry).toMatchObject({ method: 'POST', path: '/api/v1/auth/login', status: 200 });
    for (const secret of [
      'Correct-Horse-9',
      'ZZKPS1234Q',
      'oiq_header',
      'oiq_response',
      'document text',
    ])
      expect(lines[0]).not.toContain(secret);
  });
});
