#!/usr/bin/env node
/**
 * Hyperbot Identity Enrichment — pulls KOL/entity labels for wallets,
 * caches them, and stays well under the free-tier request ceiling.
 *
 * STRATEGY (the key insight):
 *   Hyperbot's value is the `remark` field — the address->identity map.
 *   We pull it ONCE, cache it, then join against our own live HL data.
 *   We never hit Hyperbot for live numbers. Only for identity refresh.
 *
 * RATE DISCIPLINE:
 *   - Hard cap of MAX_CALLS_PER_RUN requests per execution.
 *   - 7-day cache TTL: a wallet already labelled < 7 days ago is skipped.
 *   - Throttle: DELAY_MS between any two network calls.
 *
 * Run:  node hyperbot_enrich.js
 * Output: ./wallet_identities.json   (address -> {remark, stats, fetchedAt})
 */

const fs = require('fs');
const path = require('path');

// ---- CONFIG -----------------------------------------------------
const BASE = 'https://hyperbot.network/api';
const CACHE_FILE = path.join(__dirname, 'wallet_identities.json');
const MAX_CALLS_PER_RUN = 20;     // stay well under free daily limit
const DELAY_MS = 1500;            // 1.5s between calls = gentle
const CACHE_TTL_DAYS = 7;         // re-fetch identity only weekly
// Optional: set if an endpoint needs it. Free endpoints below do NOT.
const API_KEY = process.env.HYPERBOT_API_KEY || null;

// Endpoints that are free + public (confirmed via network inspection)
const ENDPOINTS = {
  recommend: `${BASE}/leaderboard/smart/recommend?lang=en&pnlList=false&period=7`,
  hot:       `${BASE}/leaderboard/smart/hot?lang=en&pnlList=false`,
};
// -----------------------------------------------------------------

let callCount = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadCache() {
  try { return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); }
  catch { return {}; }
}
function saveCache(cache) {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}
function isFresh(entry) {
  if (!entry || !entry.fetchedAt) return false;
  const ageDays = (Date.now() - entry.fetchedAt) / (1000 * 60 * 60 * 24);
  return ageDays < CACHE_TTL_DAYS;
}

async function fetchJSON(url) {
  if (callCount >= MAX_CALLS_PER_RUN) {
    throw new Error(`Rate cap reached (${MAX_CALLS_PER_RUN} calls). Stopping to protect free tier.`);
  }
  callCount++;
  const headers = { 'Accept': 'application/json' };
  if (API_KEY) headers['Authorization'] = `Bearer ${API_KEY}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`);
  await sleep(DELAY_MS);
  return res.json();
}

// Normalise one Hyperbot record into our identity schema
function normalise(rec) {
  return {
    address: rec.address.toLowerCase(),
    remark: rec.remark || null,            // the identity label
    winRate: rec.winRate ?? null,
    realizedPnL: rec.realizedPnL ?? null,
    accountTotalValue: rec.accountTotalValue ?? null,
    posCount: rec.posCount ?? null,
    tradesCount: rec.tradesCount ?? null,
    fetchedAt: Date.now(),
  };
}

async function run() {
  const cache = loadCache();
  let added = 0, skipped = 0;

  for (const [name, url] of Object.entries(ENDPOINTS)) {
    try {
      console.log(`Fetching ${name}…`);
      const json = await fetchJSON(url);
      const rows = json.data || [];
      for (const rec of rows) {
        if (!rec.address) continue;
        const key = rec.address.toLowerCase();
        if (isFresh(cache[key])) { skipped++; continue; }
        cache[key] = normalise(rec);
        added++;
      }
    } catch (err) {
      console.warn(`  ! ${name}: ${err.message}`);
      break; // stop on rate cap or error — resume next run
    }
  }

  saveCache(cache);
  const labelled = Object.values(cache).filter((e) => e.remark).length;
  console.log(`\nDone. Calls used: ${callCount}/${MAX_CALLS_PER_RUN}`);
  console.log(`Wallets added/updated: ${added}, skipped (fresh): ${skipped}`);
  console.log(`Total cached identities: ${Object.keys(cache).length} (${labelled} with labels)`);
  console.log(`Cache file: ${CACHE_FILE}`);
}

run();
