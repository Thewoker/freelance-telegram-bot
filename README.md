# Freelancer Project Scraper → Telegram

Notifica por Telegram los proyectos nuevos de Freelancer.com que matchean
las categorías/skills configuradas (por defecto: Websites/IT, Mobile &
Computing, Artificial Intelligence + skills de diseño web), con filtro
local de keywords para descartar ruido (sales/telemarketing/etc).

## Instalación

```bash
cd freelancer-scraper
npm install
cp .env.example .env
```

Editá `.env` con tu bot de Telegram:

```
TELEGRAM_BOT_TOKEN=123456:ABC-tu-token
TELEGRAM_CHAT_ID=-1001234567890
```

Si no tenés bot todavía: hablale a `@BotFather` en Telegram, `/newbot`, y
copiá el token. El `chat_id` lo sacás mandándole un mensaje al bot y
consultando `https://api.telegram.org/bot<TOKEN>/getUpdates`.

## Modos de ejecución

### Servicio (por defecto)

Bucle propio: un ciclo cada `POLL_SECONDS` segundos, más un endpoint HTTP
`/health` en el puerto `PORT` para que el orquestador sepa si está vivo.

```bash
node scraper.js
```

### Una sola pasada

Hace un ciclo y termina. Es el modo para cron.

```bash
RUN_ONCE=true node scraper.js
```

La primera corrida va a notificar TODOS los proyectos activos que
matcheen el filtro (hasta el `limit` configurado, 50 por default) porque
`seen-projects.json` todavía no existe. Es normal — de ahí en adelante
solo notifica lo nuevo.

## Variables de entorno

| Variable | Default | Qué hace |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | — | Token de BotFather. Obligatorio. |
| `TELEGRAM_CHAT_ID` | — | Canal o grupo destino. Obligatorio. |
| `POLL_SECONDS` | 300 | Segundos entre ciclos en modo servicio. |
| `RUN_ONCE` | false | Si es true, un solo ciclo y termina. |
| `STATE_PATH` | ./seen-projects.json | Archivo de IDs ya notificados. |
| `PORT` | 3000 | Puerto del health check. |
| `FREELANCER_OAUTH_TOKEN` | vacío | Opcional. El endpoint es público; solo sube el límite por IP. |

## Docker

```bash
docker compose up -d --build
```

## Despliegue en Coolify

1. Nueva aplicación, tipo **Dockerfile**, apuntando a este repositorio.
2. Variables de entorno: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` y, si
   querés cambiar el ritmo, `POLL_SECONDS`.
3. **Volumen persistente montado en `/data`.** Sin esto, cada redeploy
   arranca con el historial vacío y vuelve a notificar todo de nuevo.
4. Health check: `GET /health` en el puerto 3000.

### Cron (alternativa, sin Docker)

```bash
crontab -e
```

Agregar (corre cada 10 minutos):

```
*/10 * * * * cd /ruta/a/freelancer-scraper && /usr/bin/node scraper.js >> /var/log/freelancer-scraper.log 2>&1
```

Con `RUN_ONCE=true` en el `.env` para que no quede un proceso colgado.
Ajustá `/usr/bin/node` según el resultado de `which node`.

## Ajustar filtros

Todo el criterio de búsqueda vive en `config.js`:

- `JOB_CATEGORIES`: categorías completas (IDs de la taxonomía de Freelancer)
- `JOBS`: skills puntuales de categorías mixtas
- `LANGUAGES`: idiomas de los proyectos
- `BLOCKLIST_KEYWORDS`: palabras que descartan un proyecto aunque haya
  matcheado por categoría/skill

Para agregar/sacar categorías o skills, hay que primero identificar el ID
correspondiente. La taxonomía completa está en:

```
GET https://www.freelancer.com/api/projects/0.1/jobs/
```

## Notas

- El endpoint es público, no requiere API key para lectura. Con un ciclo cada
  5 minutos son ~288 consultas por día, muy lejos del rate limit.
- `job_categories[]` y `jobs[]` funcionan como OR entre sí — cualquier
  proyecto que matchee alguno de los IDs configurados aparece. Por eso el
  filtro de `BLOCKLIST_KEYWORDS` es importante como segunda capa.
- Nunca commitees el `.env`: tiene el token del bot y este repo es público.
- Un fallo de red o de la API no tumba el servicio. Se registra en `/health`
  y se reintenta en el ciclo siguiente.
- `seen-projects.json` guarda hasta 3000 IDs para evitar que crezca sin
  límite; se recorta automáticamente en cada corrida.
