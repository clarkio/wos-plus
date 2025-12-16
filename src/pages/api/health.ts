import type { APIRoute } from 'astro';
export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
  console.log('Health check requested');
  return new Response(JSON.stringify({
    status: 'ok',
    timestamp: Date.now()
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
};
