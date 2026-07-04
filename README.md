# Pulse — o sinal vital do planeta, agora

MVP de portfólio (Mendonça Labs): mapa mundial ao vivo com terremotos e eventos naturais, mais busca por lugar com briefing (clima + atividade próxima + sinal de notícias).

## Stack
100% estático — HTML/CSS/JS puro, sem build step, sem backend, sem chave de API.
Isso significa: hospedagem gratuita em GitHub Pages, Vercel, Netlify ou Cloudflare Pages, sem custo operacional.

## Fontes de dados
- **Terremotos**: USGS (`2.5_day.geojson`, últimas 24h, magnitude ≥ 2.5)
- **Eventos naturais**: NASA EONET v3 (incêndios, tempestades, vulcões etc., status aberto)
- **Clima atual**: Open-Meteo (sem chave)
- **Geocodificação de busca**: Open-Meteo Geocoding (sem chave)
- **Sinal de notícias**: GDELT DOC API (best-effort — ver limitação abaixo)

## Como rodar localmente
Qualquer servidor estático simples funciona, por exemplo:
```bash
cd pulse
python3 -m http.server 8080
```
Depois abra `http://localhost:8080`.

## Como publicar (grátis)
**GitHub Pages**
1. Suba os 3 arquivos (`index.html`, `style.css`, `app.js`) para um repositório.
2. Em Settings → Pages, selecione a branch e a raiz (`/`).
3. Pronto — a URL pública será `https://SEU_USUARIO.github.io/SEU_REPO/`.

**Vercel/Netlify**: arraste a pasta no dashboard, ou conecte o repositório do GitHub. Nenhuma configuração de build é necessária (é um site estático).

## Sobre o GDELT
Confirmado na documentação oficial: a GDELT DOC API libera CORS com curinga (`*`) em todas as respostas, então funciona direto do navegador sem proxy nem backend. O fallback de "sinal indisponível" continua no código como rede de segurança para instabilidades pontuais, mas não é esperado que dispare na prática.

## Changelog
- **Correção de clima**: a chamada inicial usava o parâmetro legado `current_weather=true` da Open-Meteo. Trocado para o parâmetro atual (`current=temperature_2m,wind_speed_10m,weather_code`) e adicionado timeout de 8s na requisição, para que a interface nunca fique presa em "Carregando clima…" indefinidamente — em caso de falha, agora sempre cai no aviso de indisponibilidade.

## Próximos passos sugeridos
- Proxy serverless para o GDELT (resolve a limitação acima)
- Camada de "tensão midiática" no mapa (agregando tom do GDELT por país)
- Favoritar lugares / lembrar a última busca (precisaria de storage — hoje não há persistência entre sessões)
- Modo "meu lugar" via geolocalização do navegador
