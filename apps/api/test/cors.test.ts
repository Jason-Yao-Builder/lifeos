import { afterEach, describe, expect, it } from 'vitest';
import { readConfig } from '../src/config.js';
import { createTestHarness, type TestHarness } from './harness.js';

describe('API CORS policy', () => {
  let harness: TestHarness | undefined;

  afterEach(async () => {
    await harness?.close();
    harness = undefined;
  });

  it('allows requests without Origin and local browser origins on arbitrary ports', async () => {
    harness = await createTestHarness();

    const direct = await harness.app.inject({ method: 'GET', url: '/api/v1/tasks' });
    expect(direct.statusCode).toBe(200);

    for (const origin of [
      'http://localhost',
      'https://localhost:5173',
      'http://127.0.0.1:4310',
      'https://[::1]:65535',
    ]) {
      const response = await harness.app.inject({
        method: 'GET',
        url: '/api/v1/tasks',
        headers: { origin },
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers['access-control-allow-origin']).toBe(origin);
    }

    const writePreflight = await harness.app.inject({
      method: 'OPTIONS',
      url: '/api/v1/tasks/example',
      headers: {
        origin: 'http://localhost:9876',
        'access-control-request-method': 'DELETE',
      },
    });
    expect(writePreflight.headers['access-control-allow-origin']).toBe('http://localhost:9876');
    expect(writePreflight.headers['access-control-allow-methods']).toContain('DELETE');
  });

  it('does not grant malicious origins read or write preflights', async () => {
    harness = await createTestHarness();
    const origin = 'https://attacker.example';

    for (const maliciousOrigin of [origin, 'http://localhost.attacker.example:5173']) {
      const read = await harness.app.inject({
        method: 'GET',
        url: '/api/v1/tasks',
        headers: { origin: maliciousOrigin },
      });
      expect(read.statusCode).toBe(200);
      expect(read.headers['access-control-allow-origin']).toBeUndefined();
    }

    for (const requestedMethod of ['GET', 'DELETE']) {
      const preflight = await harness.app.inject({
        method: 'OPTIONS',
        url: '/api/v1/tasks/example',
        headers: {
          origin,
          'access-control-request-method': requestedMethod,
        },
      });
      expect(preflight.headers['access-control-allow-origin']).toBeUndefined();
      expect(preflight.headers['access-control-allow-methods']).toBeUndefined();
    }
  });

  it('keeps explicit build and environment origin overrides', async () => {
    harness = await createTestHarness({ corsOrigin: 'https://app.example' });

    const trusted = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/tasks',
      headers: { origin: 'https://app.example' },
    });
    expect(trusted.headers['access-control-allow-origin']).toBe('https://app.example');

    const local = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/tasks',
      headers: { origin: 'http://localhost:5173' },
    });
    expect(local.headers['access-control-allow-origin']).toBe('https://app.example');

    expect(readConfig({}).corsOrigin).toBeUndefined();
    expect(readConfig({ CORS_ORIGIN: 'https://configured.example' }).corsOrigin).toBe(
      'https://configured.example',
    );
  });
});
