export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const { pathname } = url;
      // CORS preflight
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders() });
      }
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
      // ---------- Bridge API for shop integration ----------
      if (pathname === '/api/catalog' && request.method === 'GET') {
        const org = url.searchParams.get('org') || 'default';
        const state = await loadState(env, org);
        if (!state) return json({ ok:false, error:'state_not_found' }, 404);
        const { products } = buildCatalog(state.blob);
        return json({ ok:true, org, updatedAt: state.updated_at, products });
      }
      if (pathname === '/api/inventory' && request.method === 'GET') {
        const org = url.searchParams.get('org') || 'default';
        const state = await loadState(env, org);
        if (!state) return json({ ok:false, error:'state_not_found' }, 404);
        const inventory = buildInventory(state.blob);
        return json({ ok:true, org, updatedAt: state.updated_at, inventory });
      }
      if (pathname === '/api/orders' && request.method === 'GET') {
        const org = url.searchParams.get('org') || 'default';
        const since = url.searchParams.get('since');
        const state = await loadState(env, org);
        if (!state) return json({ ok:false, error:'state_not_found' }, 404);
        const orders = Array.isArray(state.blob?.orders) ? state.blob.orders : [];
        const filtered = since ? orders.filter(o => (o.updatedAt||o.createdAt||'') > since) : orders;
        return json({ ok:true, org, count: filtered.length, orders: filtered });
      }
      if (pathname === '/api/shop/orders/webhook' && request.method === 'POST') {
        const org = url.searchParams.get('org') || 'default';
        const raw = await request.text();
        // HMAC verification (optional)
        const secret = env.SHOP_WEBHOOK_SECRET || '';
        if (secret) {
          const sig = request.headers.get('x-shop-signature') || request.headers.get('x-signature') || '';
          const ok = await verifyHmac(raw, secret, sig);
          if (!ok) return json({ ok:false, error:'invalid_signature' }, 401);
        }
        const body = parseJsonSafe(raw) || {};
        const state = await loadState(env, org);
        if (!state) return json({ ok:false, error:'state_not_found' }, 404);
        const blob = state.blob || {};
        const models = Array.isArray(blob.models) ? blob.models : [];
        const rawItems = Array.isArray(blob.rawItems) ? blob.rawItems : [];
        const orders = Array.isArray(blob.orders) ? blob.orders : [];
        const now = new Date().toISOString();
        const orderId = uid();
        const lines = Array.isArray(body.lines) ? body.lines.map(l => ({
          id: uid(),
          modelId: resolveModelId(models, l),
          metal: l.metal || '',
          color: l.color || '',
          qty: Math.max(1, +l.qty||1),
          price: +l.price || 0,
          currency: l.currency || 'KZT',
        })) : [];
        const order = {
          id: orderId,
          externalId: body.externalId || null,
          type: 'Клиентский',
          customer: body.customer?.name || body.customer || '',
          createdAt: now,
          updatedAt: now,
          status: 'Новые заказы',
          lines,
          payments: [],
          produceFromRaw: body.produceFromRaw !== false,
          note: body.note || '',
        };
        // Reserve diamonds similar to frontend logic
        const reserve = buildDiamondReserve(models, rawItems, order);
        applyReserve(rawItems, reserve, +1);
        const nextBlob = { ...blob, rawItems, orders: [order, ...orders] };
        await saveState(env, org, nextBlob);
        return json({ ok:true, org, id: orderId });
      }
      if (pathname === '/api/shop/orders/status' && request.method === 'POST') {
        const org = url.searchParams.get('org') || 'default';
        const raw = await request.text();
        const secret = env.SHOP_WEBHOOK_SECRET || '';
        if (secret) {
          const sig = request.headers.get('x-shop-signature') || request.headers.get('x-signature') || '';
          const ok = await verifyHmac(raw, secret, sig);
          if (!ok) return json({ ok:false, error:'invalid_signature' }, 401);
        }
        const body = parseJsonSafe(raw) || {};
        const { externalId, status } = body;
        if (!externalId || !status) return json({ ok:false, error:'missing_fields' }, 400);
        const state = await loadState(env, org);
        if (!state) return json({ ok:false, error:'state_not_found' }, 404);
        const blob = state.blob || {};
        const models = Array.isArray(blob.models) ? blob.models : [];
        const rawItems = Array.isArray(blob.rawItems) ? blob.rawItems : [];
        const orders = Array.isArray(blob.orders) ? blob.orders : [];
        const o = orders.find(x => (x.externalId || x.id) === externalId);
        if (!o) return json({ ok:false, error:'order_not_found' }, 404);
        const mapped = mapShopStatusToWms(status);
        if (mapped === 'Отменён') {
          const reserve = buildDiamondReserve(models, rawItems, o);
          if (o.consumedDiamonds) applyConsume(rawItems, reserve, -1); else applyReserve(rawItems, reserve, -1);
        }
        o.status = mapped; o.updatedAt = new Date().toISOString();
        await saveState(env, org, { ...blob, rawItems, orders });
        return json({ ok:true });
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
      if (pathname === '/api/echo' && request.method === 'POST') {
        const body = await safeJson(request);
        return json({ ok: true, echo: body||null });
      }
      return new Response('Not Found', { status: 404, headers: corsHeaders() });
    } catch (e) {
      return json({ ok: false, error: String(e?.message || e) }, 500);
    }
  }
};

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...corsHeaders(), ...headers }
  });
}

async function safeJson(request) {
  try { return await request.json(); } catch { return null; }
}
function corsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type'
  };
}

// ---------- Helpers: Supabase state access ----------
async function loadState(env, org='default') {
  const url = `${env.WMS_SUPABASE_URL}/rest/v1/nd_state?org=eq.${encodeURIComponent(org)}&select=blob,updated_at`;
  const r = await fetch(url, { headers: sbHeaders(env) });
  if (!r.ok) return null;
  const arr = await r.json().catch(()=>[]);
  const row = arr && arr[0];
  if (!row) return null;
  return { blob: row.blob, updated_at: row.updated_at };
}
async function saveState(env, org, blob) {
  const url = `${env.WMS_SUPABASE_URL}/rest/v1/nd_state`;
  const body = { org, blob, updated_at: new Date().toISOString() };
  const r = await fetch(url, {
    method: 'POST',
    headers: { ...sbHeaders(env), 'content-type': 'application/json', 'prefer': 'resolution=merge-duplicates' },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(`saveState failed: ${r.status}`);
}
function sbHeaders(env){
  return { 'apikey': env.WMS_SUPABASE_SERVICE_KEY, 'authorization': `Bearer ${env.WMS_SUPABASE_SERVICE_KEY}` };
}

// ---------- Helpers: domain transforms ----------
function buildCatalog(blob){
  const models = Array.isArray(blob?.models)? blob.models : [];
  const jewelryStock = Array.isArray(blob?.jewelryStock)? blob.jewelryStock : [];
  const products = models.map(m => {
    const variants = (Array.isArray(m.variants) && m.variants.length>0)
      ? m.variants
      : buildVariantsFallback(m);
    const list = variants.map(v => ({
      id: v.id || `var-${m.id}-${(v.metal||m.defaultMetal)||'metal'}-${(v.color||m.defaultColor)||'color'}`,
      metal: v.metal || m.defaultMetal || 'Золото',
      color: v.color || m.defaultColor || 'Белый',
      price: +v.salesPrice || +m.salesPrice || 0,
      currency: v.salesCurrency || m.salesCurrency || 'KZT',
      stockQty: sumStock(jewelryStock, m.id, v.metal||m.defaultMetal, v.color||m.defaultColor),
    }));
    return { id: m.id, sku: m.sku||null, name: m.name, type: m.type, active: m.active!==false, variants: list };
  });
  return { products };
}
function buildVariantsFallback(m){
  const metals = Array.isArray(m.allowedMetals) && m.allowedMetals.length? m.allowedMetals : [m.defaultMetal||'Золото', 'Серебро'];
  const colors = [m.defaultColor || 'Белый'];
  const list = [];
  metals.forEach(metal => colors.forEach(color => list.push({ id: `virt-${m.id}-${metal}-${color}`, metal, color, salesPrice: m.salesPrice||0, salesCurrency: m.salesCurrency||'KZT' })));
  return list;
}
function sumStock(jewelryStock, modelId, metal, color){
  return (jewelryStock||[]).filter(j => j.modelId===modelId && j.metal===metal && j.color===color).reduce((s,j)=> s+(j.qty||0), 0);
}
function buildInventory(blob){
  const jewelryStock = Array.isArray(blob?.jewelryStock)? blob.jewelryStock : [];
  return jewelryStock.map(j => ({ modelId: j.modelId, metal: j.metal, color: j.color, qty: j.qty||0 }));
}
function resolveModelId(models, line){
  if (line.modelId) return line.modelId;
  if (line.sku){ const m = models.find(mm=> (mm.sku||'').toLowerCase() === String(line.sku).toLowerCase()); if (m) return m.id; }
  if (line.name){ const m = models.find(mm=> (mm.name||'').toLowerCase().includes(String(line.name).toLowerCase())); if (m) return m.id; }
  return models[0]?.id || null;
}
function buildDiamondReserve(models, rawItems, order){
  const res = {};
  const bomByModel = new Map(models.map(m => [m.id, m.bom||[]]));
  for (const l of (order.lines||[])){
    const bom = bomByModel.get(l.modelId) || [];
    for (const b of bom){
      const r = rawItems.find(x=>x.id===b.rawItemId);
      if (!r || r.category !== 'Бриллиант') continue;
      const qty = (b.qty||0) * (l.qty||1);
      res[r.id] = (res[r.id]||0) + qty;
    }
  }
  return res; // map rawId -> qty
}
function applyReserve(rawItems, reserveMap, sign){
  for (const r of rawItems){
    const q = reserveMap[r.id]; if (!q) continue;
    r.reservedQty = Math.max(0, (r.reservedQty||0) + sign*q);
  }
}
function applyConsume(rawItems, reserveMap, sign){
  for (const r of rawItems){
    const q = reserveMap[r.id]; if (!q) continue;
    r.stockQty = Math.max(0, (r.stockQty||0) + sign*q);
    r.reservedQty = Math.max(0, (r.reservedQty||0) + sign*q);
  }
}

// ---------- Crypto helpers ----------
function parseJsonSafe(text){ try { return JSON.parse(text); } catch { return null; } }
function toHex(buf){ return [...new Uint8Array(buf)].map(b=> b.toString(16).padStart(2,'0')).join(''); }
async function verifyHmac(bodyText, secret, signature){
  try{
    if (!signature) return false;
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name:'HMAC', hash:'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(bodyText));
    const hex = toHex(sig);
    return timingSafeEqual(hex, signature.replace(/^sha256=/i,''));
  }catch{ return false; }
}
function timingSafeEqual(a,b){
  const aa = String(a); const bb = String(b);
  const len = Math.max(aa.length, bb.length);
  let out = 0;
  for (let i=0;i<len;i++) out |= (aa.charCodeAt(i|0)||0) ^ (bb.charCodeAt(i|0)||0);
  return out === 0 && aa.length === bb.length;
}
function uid(){
  const arr = new Uint8Array(10); (crypto.getRandomValues||((a)=>{ for(let i=0;i<a.length;i++) a[i]=Math.floor(Math.random()*256); }))(arr);
  return Array.from(arr, b => b.toString(36).padStart(2,'0')).join('').slice(0,16) + Date.now().toString(36);
}
function mapShopStatusToWms(s){
  const map = { created:'Новые заказы', paid:'Новые заказы', in_progress:'Взят в работу', fulfilled:'Доставлено', delivered:'Доставлено', completed:'Завершено', cancelled:'Отменён' };
  return map[s] || 'Новые заказы';
}
