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

## Probar manualmente

```bash
node scraper.js
```

La primera corrida va a notificar TODOS los proyectos activos que
matcheen el filtro (hasta el `limit` configurado, 50 por default) porque
`seen-projects.json` todavía no existe. Es normal — de ahí en adelante
solo notifica lo nuevo.

## Configurar el cron

```bash
crontab -e
```

Agregar (corre cada 10 minutos):

```
*/10 * * * * cd /ruta/a/freelancer-scraper && /usr/bin/node scraper.js >> /var/log/freelancer-scraper.log 2>&1
```

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

- El endpoint es público, no requiere API key para lectura.
- `job_categories[]` y `jobs[]` funcionan como OR entre sí — cualquier
  proyecto que matchee alguno de los IDs configurados aparece. Por eso el
  filtro de `BLOCKLIST_KEYWORDS` es importante como segunda capa.
- `seen-projects.json` guarda hasta 3000 IDs para evitar que crezca sin
  límite; se recorta automáticamente en cada corrida.
