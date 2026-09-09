#!/usr/bin/env node
/**
 * Freelancer.com Project Scraper -> Telegram Notifier
 *
 * Consulta la API pública de proyectos activos de Freelancer.com filtrando
 * por categorías/skills configuradas en config.js, aplica un filtro local
 * de keywords para descartar ruido, deduplica contra ejecuciones previas
 * (seen-projects.json) y notifica los proyectos nuevos por Telegram.
 *
 * Dos modos de ejecución (ver README.md):
 *   - Servicio: bucle propio cada POLL_SECONDS, con health check HTTP. Es el
 *     modo por defecto y el que se usa en Coolify.
 *   - Una pasada: con RUN_ONCE=true hace un ciclo y termina, para cron.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
// En local carga el .env; en el contenedor las variables las inyecta Coolify y
// dotenv no esta instalado, por eso el require es opcional.
try {
  require('dotenv').config({ path: path.join(__dirname, '.env') });
} catch {
  /* sin dotenv: se usan las variables del entorno tal cual */
}

const {
  JOB_CATEGORIES,
  JOBS,
  LANGUAGES,
  BLOCKLIST_KEYWORDS,
} = require('./config');

// Los paneles de despliegue suelen guardar el valor tal cual se pega, con
// comillas o espacios incluidos. Sin limpiarlos, la URL de la API queda mal
// formada y Telegram responde 404 sin explicar por que.
function cleanEnv(name) {
  const raw = process.env[name];
  if (!raw) return raw;
  return raw.trim().replace(/^['"]|['"]$/g, '').trim();
}

const TELEGRAM_BOT_TOKEN = cleanEnv('TELEGRAM_BOT_TOKEN');
const TELEGRAM_CHAT_ID = cleanEnv('TELEGRAM_CHAT_ID');
// En Docker apunta al volumen persistente; en local, al archivo de siempre.
const SEEN_FILE = process.env.STATE_PATH || path.join(__dirname, 'seen-projects.json');
const API_URL = 'https://www.freelancer.com/api/projects/0.1/projects/active/';
const MAX_SEEN_IDS = 3000;
const POLL_SECONDS = Number(process.env.POLL_SECONDS) || 300;
const RUN_ONCE = /^(1|true|yes|on)$/i.test(process.env.RUN_ONCE || '');
const PORT = Number(process.env.PORT) || 3000;

if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
  console.error('Faltan TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID en el .env');
  process.exit(1);
}

function loadSeen() {
  if (!fs.existsSync(SEEN_FILE)) return new Set();
  try {
    return new Set(JSON.parse(fs.readFileSync(SEEN_FILE, 'utf8')));
  } catch {
    return new Set();
  }
}

function saveSeen(seenSet) {
  const arr = Array.from(seenSet).slice(-MAX_SEEN_IDS);
  fs.mkdirSync(path.dirname(SEEN_FILE), { recursive: true });
  fs.writeFileSync(SEEN_FILE, JSON.stringify(arr));
}

function buildUrl() {
  const params = new URLSearchParams();
  JOB_CATEGORIES.forEach((id) => params.append('job_categories[]', id));
  JOBS.forEach((id) => params.append('jobs[]', id));
  LANGUAGES.forEach((l) => params.append('languages[]', l));
  params.append('compact', 'true');
  params.append('limit', '50');
  params.append('sort_field', 'time_updated');
  return `${API_URL}?${params.toString()}`;
}

function isBlocked(project) {
  const haystack = `${project.title} ${project.preview_description || ''}`.toLowerCase();
  return BLOCKLIST_KEYWORDS.some((kw) => haystack.includes(kw.toLowerCase()));
}

function formatBudget(project) {
  const c = project.currency || {};
  const b = project.budget || {};
  const min = b.minimum != null ? b.minimum : null;
  const max = b.maximum != null ? b.maximum : null;
  const kind = project.type === 'hourly' ? '/hora' : 'fijo';
  const original = `${c.sign || ''}${min ?? '?'} - ${c.sign || ''}${max ?? '?'} ${c.code || ''} (${kind})`;

  const rate = c.exchange_rate;
  if (rate && rate !== 1 && min != null && max != null) {
    const minUsd = Math.round(min * rate);
    const maxUsd = Math.round(max * rate);
    return `${original} ≈ $${minUsd}-$${maxUsd} USD`;
  }
  return original;
}

function escapeMarkdown(text) {
  return String(text).replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');
}

function formatMessage(project) {
  const url = `https://www.freelancer.com/projects/${project.seo_url}`;
  const bids = (project.bid_stats && project.bid_stats.bid_count) || 0;
  const bidFlag = bids <= 5 ? ' 🔥 pocas propuestas' : '';
  return (
    `🆕 *${escapeMarkdown(project.title)}*\n` +
    `💰 ${escapeMarkdown(formatBudget(project))}\n` +
    `📨 ${bids} propuestas${bidFlag}\n` +
    `🌐 ${project.language.toUpperCase()}\n` +
    `${escapeMarkdown(url)}`
  );
}

async function sendTelegram(message) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: 'MarkdownV2',
      disable_web_page_preview: false,
    }),
  });
  if (!res.ok) {
    console.error('Error enviando a Telegram:', res.status, await res.text());
    return false;
  }
  return true;
}

async function runCycle() {
  const seen = loadSeen();

  const res = await fetch(buildUrl(), { signal: AbortSignal.timeout(20000) });
  const data = await res.json();

  if (data.status !== 'success') {
    throw new Error('Respuesta inesperada de la API: ' + JSON.stringify(data).slice(0, 300));
  }

  const projects = data.result.projects || [];
  let newCount = 0;
  let blockedCount = 0;

  for (const project of projects) {
    const id = String(project.id);
    if (seen.has(id)) continue;

    if (isBlocked(project)) {
      blockedCount++;
      seen.add(id); // los bloqueados sí se marcan, no queremos re-evaluarlos
      continue;
    }

    const ok = await sendTelegram(formatMessage(project));
    if (ok) {
      seen.add(id);
      newCount++;
    }
    // si falla el envío, NO se marca como visto -> se reintenta en la próxima corrida
    await new Promise((r) => setTimeout(r, 500)); // no saturar la API de Telegram
  }

  saveSeen(seen);
  console.log(
    `[${new Date().toISOString()}] ${projects.length} revisados, ` +
    `${newCount} notificados, ${blockedCount} descartados por blocklist.`
  );
  return { revisados: projects.length, notificados: newCount, descartados: blockedCount };
}

// Coolify necesita un endpoint que responda para dar el contenedor por sano.
function startHealthServer(status) {
  http
    .createServer((req, res) => {
      if (req.url === '/health' || req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(status, null, 2));
        return;
      }
      res.writeHead(404).end();
    })
    .listen(PORT, () => console.log(`Health check escuchando en el puerto ${PORT}.`));
}

// Falla al arrancar si el token no sirve, en vez de descubrirlo despues de
// cincuenta errores de envio con el servicio corriendo en falso.
async function checkToken() {
  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe`, {
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) {
    throw new Error(
      `TELEGRAM_BOT_TOKEN invalido (HTTP ${res.status}: ${data.description || 'sin detalle'}). ` +
      `Longitud recibida: ${TELEGRAM_BOT_TOKEN.length} caracteres. ` +
      `Revisa que no tenga comillas ni espacios y que no este revocado.`
    );
  }
  console.log(`Bot @${data.result.username} autenticado. Destino: ${TELEGRAM_CHAT_ID}.`);
}

async function main() {
  await checkToken();

  if (RUN_ONCE) {
    await runCycle();
    return;
  }

  const status = {
    ok: true,
    startedAt: new Date().toISOString(),
    lastRunAt: null,
    lastError: null,
    ciclos: 0,
    notificados: 0,
  };
  startHealthServer(status);
  console.log(`Modo servicio: un ciclo cada ${POLL_SECONDS}s.`);

  for (;;) {
    try {
      const r = await runCycle();
      status.notificados += r.notificados;
      status.lastError = null;
    } catch (err) {
      // Un fallo de red o de la API no debe tumbar el servicio: se reintenta
      // en el ciclo siguiente y queda registrado en /health.
      status.lastError = err.message;
      console.error('Ciclo fallido:', err.message);
    }
    status.ciclos++;
    status.lastRunAt = new Date().toISOString();
    await new Promise((r) => setTimeout(r, POLL_SECONDS * 1000));
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
