/* =============================================================
   arx-identity-join.js
   Merges cached Hyperbot identity labels into the ARX dashboard.

   DESIGN PRINCIPLES (per Daryl's validation discipline):
   1. Join on FULL addresses in the data layer — never on truncated
      DOM text (0x4ec8…9a80 is NOT unique; collisions are real).
   2. The label is a HINT, not truth. We always show live Sharpe +
      max-drawdown next to it, and the numbers visually override the
      name when they disagree (mirrors sharpe_at_add / reason).
   3. Identity is cached (weekly refresh). Live stats are yours,
      pulled every load. The two are decoupled.

   USAGE:
     <script src="arx-identity-join.js"></script>
     // after your leaderboard data array is built:
     ARXIdentity.enrich(traders);   // traders: [{address, sharpe, maxDrawdown, ...}]
     // then render as usual — rows now carry .identity + .trust
   ============================================================= */
(function (global) {
  'use strict';

  const IDENTITY_URL = './wallet_identities.json'; // produced by hyperbot_enrich.js
  let IDMAP = null; // { fullAddressLower: {remark, winRate, ...} }

  // ---- Trust scoring: do the live numbers back up the label? ----
  // Returns one of: 'verified' | 'caution' | 'contradicted' | 'unrated'
  // maxDrawdown is positive %, e.g. 18 means the wallet dropped -18% from peak.
  // When maxDrawdown is absent (run enrich_drawdown.js to populate it), we score
  // on Sharpe alone — dd-dependent conditions are relaxed but not removed.
  function trustVerdict(live) {
    const s  = live.sharpe;
    const dd = live.maxDrawdown;
    if (s == null) return 'unrated';
    if (dd == null) {
      // Sharpe-only path — no drawdown data yet
      if (s >= 2)  return 'verified';
      if (s < 1)   return 'contradicted';
      return 'caution';
    }
    // Full scoring: risk-adjusted return AND controlled drawdown
    if (s >= 2 && dd <= 20) return 'verified';
    // Either metric alone can contradict a label
    if (s < 1 || dd > 50)  return 'contradicted';
    return 'caution';
  }

  // Strip the bilingual 【…】 / (…) suffix for LATAM/SEA market display
  function cleanLabel(remark, keepNative) {
    if (!remark) return null;
    if (keepNative) return remark;
    return remark.replace(/[【(（].*?[】)）]/g, '').trim() || remark;
  }

  async function loadMap() {
    if (IDMAP) return IDMAP;
    try {
      const res = await fetch(IDENTITY_URL, { cache: 'no-store' });
      const raw = await res.json();
      // raw is { addr: {remark, winRate, realizedPnL, ...} } from the cache file
      IDMAP = {};
      for (const [addr, rec] of Object.entries(raw)) {
        IDMAP[addr.toLowerCase()] = rec;
      }
    } catch (e) {
      console.warn('[ARXIdentity] no identity cache yet:', e.message);
      IDMAP = {};
    }
    return IDMAP;
  }

  // Enrich an array of trader rows IN PLACE.
  // Each row must have a FULL .address (0x + 40 hex).
  async function enrich(traders, opts = {}) {
    const map = await loadMap();
    let matched = 0;
    for (const t of traders) {
      const key = (t.address || '').toLowerCase();
      const hit = key && map[key];
      const verdict = trustVerdict(t);
      t.trust = verdict;
      if (hit && hit.remark) {
        matched++;
        t.identity = {
          label: cleanLabel(hit.remark, opts.keepNative),
          labelRaw: hit.remark,
          source: 'hyperbot',
          hbWinRate: hit.winRate,
          fetchedAt: hit.fetchedAt,
          // The verdict decides whether the label gets trusted styling
          trusted: verdict === 'verified',
          contradicted: verdict === 'contradicted',
        };
      } else {
        t.identity = null;
      }
    }
    console.log(`[ARXIdentity] matched ${matched}/${traders.length} wallets to labels`);
    return traders;
  }

  // ---- DISPLAY HELPERS -----------------------------------------
  // Build the BADGE cell content: label + trust chip + live numbers.
  // Numbers override the name: a contradicted label is struck + greyed,
  // and the live Sharpe/DD chip is what's emphasised.
  function badgeHTML(t) {
    const tier = t.tier || ''; // existing Elite/Proven/etc
    const id = t.identity;
    const s    = (t.sharpe      != null) ? t.sharpe.toFixed(2)              : '—';
    const dd   = (t.maxDrawdown != null) ? `-${t.maxDrawdown.toFixed(0)}%` : 'no DD';
    const ddTip = t.maxDrawdown == null  ? ' title="Run enrich_drawdown.js to populate"' : '';

    const trustColor = {
      verified: '#1D9E75',
      caution: '#BA7517',
      contradicted: '#A32D2D',
      unrated: '#888780',
    }[t.trust] || '#888780';

    const trustLabel = {
      verified: 'verified by numbers',
      caution: 'mixed signals',
      contradicted: 'label vs numbers ✗',
      unrated: 'no track record',
    }[t.trust] || '';

    // The identity label — struck through if numbers contradict it
    let labelPart = '';
    if (id) {
      const strike = id.contradicted ? 'text-decoration:line-through;opacity:0.5;' : '';
      const weight = id.trusted ? '600' : '400';
      labelPart = `<span class="arx-id-label" title="${id.labelRaw}"
        style="font-weight:${weight};${strike}">${id.label}</span>`;
    }

    // The numbers chip — always shown, always authoritative
    const numbers = `<span class="arx-id-numbers"
      style="font-size:11px;color:${trustColor};white-space:nowrap;">
      Sharpe ${s} · DD <span${ddTip}>${dd}</span></span>`;

    const trustChip = `<span class="arx-trust-chip"
      style="font-size:10px;color:${trustColor};border:0.5px solid ${trustColor};
      border-radius:4px;padding:1px 6px;margin-left:4px;">${trustLabel}</span>`;

    return `<div style="display:flex;flex-direction:column;gap:2px;">
      <div>${labelPart || `<span style="opacity:0.6">${tier}</span>`}${id ? trustChip : ''}</div>
      <div>${numbers}</div>
    </div>`;
  }

  // Patch the rendered Wallet Taxonomy table (#tTbl) AFTER it renders.
  // Keyed by full address passed via a data attribute we add at render.
  function decorateTaxonomyTable(tableId, traders) {
    const t = document.getElementById(tableId);
    if (!t) return;
    const byAddr = {};
    traders.forEach(tr => { if (tr.address) byAddr[tr.address.toLowerCase()] = tr; });

    [...t.querySelectorAll('tbody tr')].forEach(row => {
      const full = (row.getAttribute('data-address') || '').toLowerCase();
      const tr = byAddr[full];
      if (!tr) return;
      const badgeCell = row.children[2]; // BADGE column index
      if (badgeCell) badgeCell.innerHTML = badgeHTML(tr);
    });
  }

  // For the Whales tab: returns an identity header block for a selected wallet.
  function whaleIdentityBlock(t) {
    const id = t.identity;
    const s  = (t.sharpe      != null) ? t.sharpe.toFixed(2)              : '—';
    const dd = (t.maxDrawdown != null) ? `-${t.maxDrawdown.toFixed(0)}%` : 'no DD';
    const trustColor = {
      verified: '#1D9E75', caution: '#BA7517',
      contradicted: '#A32D2D', unrated: '#888780',
    }[t.trust] || '#888780';

    const name = id
      ? `<span style="${id.contradicted ? 'text-decoration:line-through;opacity:0.5;' : ''}">${id.label}</span>`
      : '<span style="opacity:0.6">Unlabelled wallet</span>';

    const warn = id && id.contradicted
      ? `<div style="color:#A32D2D;font-size:12px;margin-top:4px;">
         ⚠ Reputation label not supported by live performance — trust the numbers.</div>`
      : '';

    return `<div style="border-left:3px solid ${trustColor};padding-left:12px;margin-bottom:12px;">
      <div style="font-size:15px;font-weight:500;">${name}</div>
      <div style="font-size:12px;color:${trustColor};margin-top:2px;">
        Live Sharpe ${s} · Max drawdown ${dd} · ${t.trust}</div>
      ${warn}
    </div>`;
  }

  global.ARXIdentity = {
    enrich, loadMap, badgeHTML, decorateTaxonomyTable,
    whaleIdentityBlock, trustVerdict, cleanLabel,
  };
})(window);
