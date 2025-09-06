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
      if (pathname === '/api/telegram/notify' && request.method === 'POST') {
        const body = await safeJson(request) || {};
        const token = env.TELEGRAM_BOT_TOKEN;
        const chatId = body.chatId || env.TELEGRAM_CHAT_ID;
        const text = String(body.text || '').slice(0, 4000);
        const parseMode = body.parse_mode || body.parseMode || 'HTML';
        if (!token) return json({ ok:false, error: 'TELEGRAM_BOT_TOKEN not configured' }, 400);
        if (!chatId) return json({ ok:false, error: 'chatId is required' }, 400);
        if (!text) return json({ ok:false, error: 'text is required' }, 400);
        const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text, parse_mode: parseMode, disable_web_page_preview: true })
        });
        const data = await resp.json().catch(()=> ({}));
        if (!resp.ok || !data?.ok) {
          return json({ ok:false, error: data?.description || `Telegram error ${resp.status}` }, 502);
        }
        return json({ ok:true, result: data.result?.message_id || null });
      }
