import { describe, expect, it } from 'vitest';

import { jsonResponse } from '../../src/lib/api-utils';

const ALLOWED_ORIGIN = 'https://wosplus.com';

function requestFrom(origin = ALLOWED_ORIGIN): Request {
  return new Request('https://wos-plus.test/api/example', {
    headers: { origin },
  });
}

describe('jsonResponse', () => {
  it('serializes the body as JSON with the default success status', async () => {
    const response = jsonResponse(
      { status: 'ok' },
      {
        request: requestFrom(),
        env: { CORS_ALLOWED_ORIGINS: ALLOWED_ORIGIN },
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('applies the shared CORS policy and the route method set', () => {
    const response = jsonResponse(
      { error: 'nope' },
      {
        request: requestFrom(),
        env: { CORS_ALLOWED_ORIGINS: ALLOWED_ORIGIN },
        allowedMethods: ['GET', 'POST', 'OPTIONS'],
        status: 400,
      },
    );

    expect(response.status).toBe(400);
    expect(response.headers.get('access-control-allow-origin')).toBe(ALLOWED_ORIGIN);
    expect(response.headers.get('access-control-allow-methods')).toBe('GET, POST, OPTIONS');
    expect(response.headers.get('vary')).toBe('Origin');
  });

  it('omits the origin grant when no origins are configured', () => {
    const response = jsonResponse([], {
      request: requestFrom(),
      env: { CORS_ALLOWED_ORIGINS: undefined },
    });

    expect(response.headers.has('access-control-allow-origin')).toBe(false);
    expect(response.headers.get('vary')).toBe('Origin');
  });
});
