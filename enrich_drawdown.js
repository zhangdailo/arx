#!/usr/bin/env node
/**
 * enrich_drawdown.js — Add maxDrawdown to arx_enriched.json
 *
 * For each wallet (up to TOP_N by rank), fetches portfolio history from the
 * Hyperliquid info API and computes the peak-to-trough max drawdown.
 * Skips wallets that already have a fresh maxDrawdown (< CACHE_TTL_DAYS old)
 * unless --refresh is passed.
 *
 * Run:
 *   node enrich_drawdown.js            # top 500, skip fresh
 *   node enrich_drawdown.js --refresh  # re-fetch all (ignores cached DD)
 *   node enrich_drawdown.js --top 200  # limit to top 200 by rank
 *
 * Output: arx_enriched.json is updated in place.
 */

const fs   = require('fs');
const path = require('path');

// ---- CONFIG -------------------------------------------------------
const HL_INFO_URL   = 'https://api.hyperliquid.xyz/info';
const ENRICHED_FILE = path.join(__dirname, 'arx_enriched.json');
const TOP_N         = Number(process.env.TOP_N  || 500);
const DELAY_MS      = Number(process.env.DELAY  || 400);  // 400ms ≈ 150 req/min
const CACHE_TTL_DAYS = 7;
// -------------------------------------------------------------------

const args    = process.argv.slice(2);
const refresh = args.includes('--refresh');
const topArg  = args.indexOf('--top');
const topN    = topArg >= 0 ? Number(args[topArg + 1]) : TOP_N;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Peak-to-trough max drawdown as a positive percentage.
// Input: array of {time, pnl} or numeric equity values.
// Returns null if fewer than 2 data points.
function computeMaxDrawdown(history) {
  const values = history
    .map((p) => (typeof p === 'number' ? p : Number(p.accountValue ?? p.equity ?? p.pnl ?? 0)))
    .filter((v) => isFinite(v));

  if (values.length < 2) return null;

  let peak = values[0];
  let maxDD = 0;
  for (const v of values) {
    if (v > peak) peak = v;
    if (peak > 0) {
      const dd = ((peak - v) / peak) * 100;
      if (dd > maxDD) maxDD = dd;
    }
  }
  return Math.round(maxDD * 100) / 100; // 2 decimal places
}

function isFresh(trader) {
  if (trader.maxDrawdown == null || !trader.ddFetchedAt) return false;
  const ageDays = (Date.now() - trader.ddFetchedAt) / (86400 * 1000);
  return ageDays < CACHE_TTL_DAYS;
}

// Returns array of numeric account values for the allTime period.
// HL response: [[period, {accountValueHistory: [[ts, "val"], ...]}], ...]
async function fetchPortfolioHistory(address) {
  const body = JSON.stringify({ type: 'portfolio', user: address });
  const res  = await fetch(HL_INFO_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const periods = await res.json();
  // Prefer allTime; fall back to the longest period available
  const sorted = [...periods].sort((a, b) => {
    const order = ['allTime', 'month', 'week', 'day'];
    return order.indexOf(a[0]) - order.indexOf(b[0]);
  });
  const [, data] = sorted[0] || [];
  const hist = (data && data.accountValueHistory) || [];
  return hist.map(([, v]) => parseFloat(v)).filter(isFinite);
}

async function run() {
  if (!fs.existsSync(ENRICHED_FILE)) {
    console.error(`Not found: ${ENRICHED_FILE}`);
    process.exit(1);
  }

  const data    = JSON.parse(fs.readFileSync(ENRICHED_FILE, 'utf8'));
  const traders = data.traders || [];

  // Sort by rank, take topN
  const target = traders
    .filter((t) => t.address)
    .sort((a, b) => (a.rank || 9999) - (b.rank || 9999))
    .slice(0, topN);

  console.log(`enrich_drawdown: ${target.length} wallets (top ${topN} by rank)`);
  console.log(`mode: ${refresh ? 'refresh all' : `skip fresh (< ${CACHE_TTL_DAYS}d)`}`);
  console.log(`delay: ${DELAY_MS}ms between calls\n`);

  let fetched = 0, skipped = 0, failed = 0;

  for (let i = 0; i < target.length; i++) {
    const t = target[i];

    if (!refresh && isFresh(t)) {
      skipped++;
      continue;
    }

    try {
      const values = await fetchPortfolioHistory(t.address);
      const dd = computeMaxDrawdown(values);
      t.maxDrawdown  = dd;
      t.ddFetchedAt  = Date.now();

      fetched++;
      const pct = (((i + 1) / target.length) * 100).toFixed(1);
      process.stdout.write(
        `\r[${pct}%] ${fetched} fetched, ${skipped} skipped, ${failed} failed — last: rank ${t.rank} DD ${dd != null ? dd.toFixed(1) + '%' : 'null'}    `
      );
    } catch (err) {
      failed++;
      t.maxDrawdown = null; // leave null so trustVerdict uses sharpe-only
      process.stderr.write(`\n  ! rank ${t.rank} (${t.address.slice(0, 10)}…): ${err.message}\n`);
    }

    if (i < target.length - 1) await sleep(DELAY_MS);
  }

  // Write back — update the source objects in data.traders by address
  const byAddr = {};
  for (const t of target) byAddr[t.address.toLowerCase()] = t;
  for (const t of data.traders) {
    const enriched = byAddr[(t.address || '').toLowerCase()];
    if (enriched) {
      t.maxDrawdown = enriched.maxDrawdown;
      t.ddFetchedAt = enriched.ddFetchedAt;
    }
  }
  data.dd_enriched_at = new Date().toISOString();
  fs.writeFileSync(ENRICHED_FILE, JSON.stringify(data, null, 2));

  console.log(`\n\nDone.`);
  console.log(`  fetched: ${fetched}  skipped (fresh): ${skipped}  failed: ${failed}`);
  console.log(`  written: ${ENRICHED_FILE}`);

  const withDD   = data.traders.filter((t) => t.maxDrawdown != null).length;
  const withoutDD = data.traders.filter((t) => t.maxDrawdown == null).length;
  console.log(`  maxDrawdown coverage: ${withDD} have it, ${withoutDD} still null (sharpe-only scoring)`);
}

run().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
