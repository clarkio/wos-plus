import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { jsonResponse } from '../../lib/api-utils';
import { createCorsPreflightResponse } from '../../lib/cors';

export const prerender = false;
const ALLOWED_METHODS = ['GET', 'OPTIONS'] as const;

export const OPTIONS: APIRoute = ({ request }) =>
  createCorsPreflightResponse(request, env, ALLOWED_METHODS);

export const GET: APIRoute = ({ request }) => {
  console.log('Health check requested');
  return jsonResponse({
    status: 'ok',
    timestamp: Date.now(),
  }, request, ALLOWED_METHODS);
};
