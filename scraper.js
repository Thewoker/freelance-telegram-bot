#!/usr/bin/env node
/**
 * Freelancer.com Project Scraper -> Telegram Notifier
 *
 * Consulta la API pública de proyectos activos de Freelancer.com filtrando
 * por categorías/skills configuradas en config.js, aplica un filtro local
 * de keywords para descartar ruido, deduplica contra ejecuciones previas
 * (seen-projects.json) y notifica los proyectos nuevos por Telegram.
 *
 * Pensado para correr vía cron cada 5-10 minutos (ver README.md).
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const {
  JOB_CATEGORIES,
  JOBS,
  LANGUAGES,
  BLOCKLIST_KEYWORDS,
} = require('./config');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const SEEN_FILE = path.join(__dirname, 'seen-projects.json');
const API_URL = 'https://www.freelancer.com/api/projects/0.1/projects/active/';
const MAX_SEEN_IDS = 3000;

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

async function main() {
  const seen = loadSeen();

  let data;
  try {
    const res = await fetch(buildUrl());
    data = await res.json();
  } catch (err) {
    console.error('Error consultando la API de Freelancer:', err.message);
    process.exit(1);
  }

  if (data.status !== 'success') {
    console.error('Respuesta inesperada de la API:', JSON.stringify(data).slice(0, 300));
    process.exit(1);
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
}

main();
