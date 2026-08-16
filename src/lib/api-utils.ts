import { env } from 'cloudflare:workers';
import { getCorsHeaders } from './cors';

/**
 * Creates a JSON response with the API's shared CORS policy.
 */
export function jsonResponse(
  body: unknown,
  request: Request,
  allowedMethods?: readonly string[],
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...getCorsHeaders(request, env, allowedMethods),
      'Content-Type': 'application/json',
    },
  });
}
