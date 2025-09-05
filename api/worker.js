export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const { pathname } = url;
      if (pathname === '/api/health') {
        return json({ ok: true, ts: new Date().toISOString() });
      }
      if (pathname === '/api/finolog/sync' && request.method === 'POST') {
        // Placeholder: here we would call Finolog API using env.FINOLOG_API_KEY
        // and payload from the client. For security, store tokens only in env.
        const body = await safeJson(request);
        // TODO: implement mapping + Finolog calls
        return json({ ok: true, received: body||null });
      }
      if (pathname === '/api/echo' && request.method === 'POST') {
        const body = await safeJson(request);
        return json({ ok: true, echo: body||null });
      }
      return new Response('Not Found', { status: 404 });
    } catch (e) {
      return json({ ok: false, error: String(e?.message || e) }, 500);
    }
  }
};

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers }
  });
}

async function safeJson(request) {
  try { return await request.json(); } catch { return null; }
}

