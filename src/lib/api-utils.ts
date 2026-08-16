import { getCorsHeaders, type CorsEnv } from './cors';

type JsonResponseOptions = {
  request: Request;
  env?: CorsEnv;
  allowedMethods?: readonly string[];
  status?: number;
};

/**
 * Creates a JSON response with the API's shared CORS policy.
 */
export function jsonResponse(
  body: unknown,
  {
    request,
    env,
    allowedMethods,
    status = 200,
  }: JsonResponseOptions,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...getCorsHeaders(request, env, allowedMethods),
      'Content-Type': 'application/json',
    },
  });
}
