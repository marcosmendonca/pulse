// Cloudflare Pages Function — roda no servidor, não no navegador do usuário.
// Rota: /api/news?q=NOME_DO_LUGAR
// Faz a chamada ao GDELT com retries e guarda a resposta em cache por 30 min,
// para absorver a instabilidade conhecida da API pública deles.

export async function onRequestGet(context) {
  const { request } = context;
  const reqUrl = new URL(request.url);
  const query = reqUrl.searchParams.get('q');

  if (!query || query.trim().length === 0) {
    return jsonResponse({ articles: [], error: 'parâmetro "q" ausente' }, 400);
  }

  // Cache por URL completa (inclui o "q"), respeitando o cache de borda da Cloudflare
  const cache = caches.default;
  const cacheKey = new Request(reqUrl.toString(), request);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const gdeltUrl = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent('"' + query + '"')}&mode=artlist&format=json&maxrecords=6&sort=datedesc&timespan=3d`;

  let articles = [];
  let lastError = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(gdeltUrl, { signal: controller.signal, headers: { 'User-Agent': 'PulseApp/1.0' } });
      clearTimeout(timeout);

      if (res.ok) {
        const text = await res.text();
        if (text && text.trim().length > 2) {
          const data = JSON.parse(text);
          articles = (data.articles || []).slice(0, 5);
          lastError = null;
          break; // sucesso, para de tentar
        } else {
          lastError = 'resposta vazia do GDELT';
        }
      } else {
        lastError = `HTTP ${res.status}`;
      }
    } catch (e) {
      lastError = (e.name || 'Erro') + ': ' + (e.message || 'desconhecido');
    }
    // pequena pausa antes da próxima tentativa
    if (attempt < 2) await new Promise(r => setTimeout(r, 900));
  }

  const payload = { articles, error: articles.length > 0 ? null : lastError };

  const response = jsonResponse(payload, 200, articles.length > 0);
  // só guarda em cache se deu certo — não vale a pena cachear uma falha
  if (articles.length > 0) {
    context.waitUntil(cache.put(cacheKey, response.clone()));
  }
  return response;
}

function jsonResponse(payload, status, cacheable) {
  const headers = { 'content-type': 'application/json; charset=utf-8' };
  if (cacheable) headers['cache-control'] = 'public, max-age=1800'; // 30 min
  return new Response(JSON.stringify(payload), { status, headers });
    }
