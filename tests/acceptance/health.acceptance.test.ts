// @vitest-environment node
/**
 * Acceptance tests for the WoS+ liveness check.
 *
 * Spec: specs/game-flow.md § "Is WoS+ itself up?"
 *
 * This is also the smoke test for the acceptance harness itself: it is the one
 * route with no Supabase dependency, so if it passes, `api-harness.ts` and
 * `network-mock.ts` are wired up correctly.
 */

import { describe, expect, it } from 'vitest';

import * as healthRoute from '../../src/pages/api/health';
import { GET } from '../../src/pages/api/health';
import { invokeRoute, readJson, responseHeaders } from './api-harness';
import { setupNetworkMocking, unhandledNetworkRequests } from './network-mock';

setupNetworkMocking();

describe('specs/game-flow.md — Is WoS+ itself up?', () => {
  describe('Scenario: checking that WoS+ is running', () => {
    // Given someone wants to know whether WoS+ is available
    // When they ask WoS+ whether it is running
    // Then WoS+ answers that it is running, and says when it answered

    it('answers that it is running', async () => {
      const response = await invokeRoute(GET, { url: '/api/health' });

      expect(response.status).toBe(200);
      expect(await readJson(response)).toMatchObject({ status: 'ok' });
    });

    it('says when it answered', async () => {
      const before = Date.now();
      const response = await invokeRoute(GET, { url: '/api/health' });
      const after = Date.now();

      const body = await readJson<{ timestamp: number }>(response);

      expect(typeof body.timestamp).toBe('number');
      expect(body.timestamp).toBeGreaterThanOrEqual(before);
      expect(body.timestamp).toBeLessThanOrEqual(after);
    });

    it('answers in a form a monitor can read', async () => {
      const response = await invokeRoute(GET, { url: '/api/health' });

      expect(responseHeaders(response)['content-type']).toBe('application/json');
    });

    // "This check never touches the board archive, the word list or the channel
    // records, so it stays truthful about WoS+ itself even when everything
    // behind it is unavailable."
    //
    // No MSW handler is registered, so any outbound request would be refused
    // and recorded — the assertion below reads that recording directly rather
    // than relying on the suite-wide afterEach.
    it('never touches the board archive, the word list or the channel records', async () => {
      const response = await invokeRoute(GET, {
        url: '/api/health',
        // Credentials are present and valid-looking: the route still must not
        // use them.
        workerEnv: {
          SUPABASE_URL: 'https://unreachable.supabase.invalid',
          SUPABASE_KEY: 'unused-by-a-liveness-check',
        },
      });

      expect(response.status).toBe(200);
      expect(unhandledNetworkRequests()).toEqual([]);
    });
  });
});

describe('/api/health — transport concerns (no spec section)', () => {
  const allowedOrigin = 'https://wosplus.com';

  it('uses the configured CORS policy on its JSON response', async () => {
    const response = await invokeRoute(GET, {
      url: '/api/health',
      headers: { origin: allowedOrigin },
      workerEnv: { CORS_ALLOWED_ORIGINS: allowedOrigin },
    });

    expect(responseHeaders(response)).toMatchObject({
      'access-control-allow-origin': allowedOrigin,
      'access-control-allow-methods': 'GET, OPTIONS',
      'vary': 'Origin',
    });
  });

  it('exports and answers the OPTIONS handler its CORS headers advertise', async () => {
    const exportedHandlers = Object.keys(healthRoute)
      .filter((name) => /^[A-Z]+$/.test(name))
      .sort();

    expect(exportedHandlers).toEqual(['GET', 'OPTIONS']);

    const response = await invokeRoute(healthRoute.OPTIONS, {
      method: 'OPTIONS',
      url: '/api/health',
      headers: { origin: allowedOrigin },
      workerEnv: { CORS_ALLOWED_ORIGINS: allowedOrigin },
    });

    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    expect(responseHeaders(response)['access-control-allow-origin']).toBe(allowedOrigin);
  });
});
