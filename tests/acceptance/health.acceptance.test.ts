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
