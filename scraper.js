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
// Opcional: el endpoint de proyectos activos es publico y no lo necesita. Solo
// sirve si algun dia el volumen de consultas creciera lo suficiente como para
// rozar el rate limit por IP.
const FREELANCER_OAUTH_TOKEN = cleanEnv('FREELANCER_OAUTH_TOKEN') || '';
// En Docker apunta al volumen persistente; en local, al archivo de siempre.
const SEEN_FILE = process.env.STATE_PATH || path.join(__dirname, 'seen-projects.json');
const API_URL = 'https://www.freelancer.com/api/projects/0.1/projects/active/';
const MAX_SEEN_IDS = 3000;
const POLL_SECONDS = Number(process.env.POLL_SECONDS) || 300;
// Limite de Telegram para un mensaje; se deja margen por el encabezado.
const TELEGRAM_MAX = 3900;
// Desde cuantos proyectos conviene agrupar en un solo mensaje.
const AGRUPAR_DESDE = Number(process.env.AGRUPAR_DESDE) || 3;
// Imprime los mensajes en consola en vez de enviarlos. Para probar filtros.
const DRY_RUN = /^(1|true|yes|on)$/i.test(process.env.DRY_RUN || '');
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

/* Dentro de un enlace de MarkdownV2 solo hay que escapar el parentesis que
 * cerraria la URL antes de tiempo. */
function escapeUrl(url) {
  return String(url).replace(/([)\\])/g, '\\$1');
}

function projectUrl(project) {
  return `https://www.freelancer.com/projects/${project.seo_url}`;
}

function formatMessage(project) {
  const bids = (project.bid_stats && project.bid_stats.bid_count) || 0;
  const bidFlag = bids <= 5 ? ' 🔥 pocas propuestas' : '';
  return (
    `🆕 *${escapeMarkdown(project.title)}*\n` +
    `💰 ${escapeMarkdown(formatBudget(project))}\n` +
    `📨 ${bids} propuestas${bidFlag}\n` +
    `🌐 ${project.language.toUpperCase()}\n` +
    `${escapeMarkdown(projectUrl(project))}`
  );
}

/* Version compacta para cuando llegan varios de golpe: el titulo es el enlace,
 * asi entra todo en pocas lineas. */
function formatEntry(project) {
  const bids = (project.bid_stats && project.bid_stats.bid_count) || 0;
  const bidFlag = bids <= 5 ? ' 🔥' : '';
  return (
    `• [${escapeMarkdown(project.title)}](${escapeUrl(projectUrl(project))})\n` +
    `  ${escapeMarkdown(formatBudget(project))} · ${bids} propuestas${bidFlag}` +
    ` · ${project.language.toUpperCase()}`
  );
}

/* Arma el resumen y lo parte si no entra en un mensaje de Telegram. Devuelve
 * pares de mensaje y los proyectos que incluye, para poder marcar como vistos
 * solo los que se enviaron bien. */
function buildDigest(projects) {
  const total = projects.length;
  const entradas = projects.map((p) => ({ texto: formatEntry(p), project: p }));

  const mensajes = [];
  let actual = null;

  for (const { texto, project } of entradas) {
    const encabezado = () =>
      mensajes.length === 0
        ? `🆕 *${total} proyectos nuevos*`
        : `🆕 *${total} proyectos nuevos* \\(continuacion\\)`;

    if (!actual) actual = { partes: [encabezado()], projects: [] };

    const largoSiSumo = actual.partes.join('\n\n').length + texto.length + 2;
    if (largoSiSumo > TELEGRAM_MAX) {
      mensajes.push(actual);
      actual = { partes: [encabezado()], projects: [] };
    }

    actual.partes.push(texto);
    actual.projects.push(project);
  }

  if (actual) mensajes.push(actual);
  return mensajes.map((m) => ({ texto: m.partes.join('\n\n'), projects: m.projects }));
}

async function sendTelegram(message) {
  if (DRY_RUN) {
    console.log(`\n--- mensaje (${message.length} caracteres) ---\n${message}\n`);
    return true;
  }

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

  const enviar = (cuerpo) =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
    });

  const base = { chat_id: TELEGRAM_CHAT_ID, disable_web_page_preview: false };
  const res = await enviar({ ...base, text: message, parse_mode: 'MarkdownV2' });
  if (res.ok) return true;

  const detalle = await res.text();

  // Un solo caracter mal escapado tira todo el mensaje. Antes que perder los
  // avisos, se reenvia sin formato: se ven las barras de escape pero llega.
  if (res.status === 400 && /can't parse entities/i.test(detalle)) {
    console.error('Telegram rechazo el formato, reenviando sin formato:', detalle.slice(0, 200));
    const plano = message
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1\n  $2')
      .replace(/\\([_*[\]()~`>#+\-=|{}.!])/g, '$1');
    const reintento = await enviar({ ...base, text: plano });
    if (reintento.ok) return true;
    console.error('Tampoco salio sin formato:', reintento.status, await reintento.text());
    return false;
  }

  console.error('Error enviando a Telegram:', res.status, detalle);
  return false;
}

async function runCycle() {
  const seen = loadSeen();

  const headers = { accept: 'application/json' };
  if (FREELANCER_OAUTH_TOKEN) headers['freelancer-oauth-v1'] = FREELANCER_OAUTH_TOKEN;

  const res = await fetch(buildUrl(), { headers, signal: AbortSignal.timeout(20000) });
  const data = await res.json();

  if (data.status !== 'success') {
    throw new Error('Respuesta inesperada de la API: ' + JSON.stringify(data).slice(0, 300));
  }

  const projects = data.result.projects || [];
  let newCount = 0;
  let blockedCount = 0;

  // Primero se separa el trigo de la paja, y recien despues se envia: asi se
  // sabe cuantos son y se puede decidir si van juntos o por separado.
  const nuevos = [];
  for (const project of projects) {
    const id = String(project.id);
    if (seen.has(id)) continue;

    if (isBlocked(project)) {
      blockedCount++;
      seen.add(id); // los bloqueados sí se marcan, no queremos re-evaluarlos
      continue;
    }
    nuevos.push(project);
  }

  // Los mas viejos primero, para que el canal quede en orden cronologico.
  nuevos.sort((a, b) => (a.time_submitted || 0) - (b.time_submitted || 0));

  const envios =
    nuevos.length >= AGRUPAR_DESDE
      ? buildDigest(nuevos)
      : nuevos.map((p) => ({ texto: formatMessage(p), projects: [p] }));

  for (const envio of envios) {
    const ok = await sendTelegram(envio.texto);
    if (ok) {
      // Si falla, esos proyectos NO se marcan y se reintentan en la proxima corrida.
      envio.projects.forEach((p) => seen.add(String(p.id)));
      newCount += envio.projects.length;
    }
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
  if (DRY_RUN) {
    console.log('DRY_RUN activo: no se envia nada a Telegram.');
    return;
  }

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
