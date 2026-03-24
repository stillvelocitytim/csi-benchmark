/* ==========================================================================
   CSI — Supabase data layer + rendering
   Reads from Supabase REST API (PostgREST), renders into DOM placeholders.
   ========================================================================== */

const SUPABASE_URL = 'https://aclclaazduenkpmdsgsj.supabase.co';
const SUPABASE_KEY = 'sb_publishable_wWJYyf3s9iOgoii7QT3udw_lCXnqrUZ';

const HEADERS = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
};

/* — CSS variable helper for Chart.js — */
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/* — Generic fetch helper — */
async function sbFetch(table, params = '') {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${params}`;
  const resp = await fetch(url, { headers: HEADERS });
  if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
  return resp.json();
}

/* — Log-scale normalizer: values > 10 are on the old linear scale — */
function normCSI(v) { return v > 10 ? Math.log(v) : v; }

/* — CS/CD denormalizer: negative values are old log-scale, convert back to raw ratio — */
function denormCS(v) { return v < 0 ? Math.exp(v) : v; }

/* — Formatting helpers — */
function fmt(n, decimals = 2) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toFixed(decimals);
}
function fmtCost(n) {
  if (n == null || isNaN(n)) return '—';
  return '$' + Number(n).toFixed(6);
}
function fmtPct(n) {
  if (n == null || isNaN(n)) return '—';
  const sign = n >= 0 ? '+' : '';
  return sign + Number(n * 100).toFixed(1) + '%';
}
function shortModel(m) {
  const map = {
    'claude-sonnet-4-20250514': 'Claude Sonnet 4',
    'claude-opus-4-20250514': 'Claude Opus 4',
    'gpt-4o': 'GPT-4o',
    'gpt-4o-mini': 'GPT-4o Mini',
    'gemini-2.0-flash': 'Gemini 2.0 Flash',
    'gemini-2.5-flash': 'Gemini 2.5 Flash',
    'gemini-2.5-pro': 'Gemini 2.5 Pro',
    'meta-llama/llama-3.3-70b-instruct': 'Llama 3.3 70B',
    'mistralai/mistral-large-2411': 'Mistral Large',
    'claude-haiku-4-5-20251001': 'Claude Haiku 4.5',
    'nvidia/llama-3.3-nemotron-super-49b-v1.5': 'Nemotron Super 49B',
    'deepseek/deepseek-v3.2': 'DeepSeek V3.2',
    'deepseek/deepseek-r1-0528': 'DeepSeek R1',
    'cohere/command-a': 'Cohere Command A',
    'cohere/command-r-plus-08-2024': 'Cohere Command R+',
    'x-ai/grok-3': 'Grok 3',
    'qwen/qwen-2.5-72b-instruct': 'Qwen 2.5 72B',
  };
  return map[m] || m;
}

/* — Tier color by CSI (log scale: ~1–8 range) — */
function csiTierColor(csi) {
  if (csi >= 6) return '#1D9E75';
  if (csi >= 4) return '#378ADD';
  if (csi >= 2) return '#BA7517';
  return '#A32D2D';
}

function fmtTaskCost(cost) {
  if (cost >= 1) return '$' + cost.toFixed(2);
  if (cost >= 0.01) return '$' + cost.toFixed(2);
  return '$' + cost.toFixed(3);
}

/* — Show fallback when no data — */
function showFallback(el, msg) {
  el.innerHTML = `
    <div class="fallback">
      <div class="fallback-icon">&#9711;</div>
      <p>${msg || 'No data available yet. Run the benchmark harness to generate measurements.'}</p>
    </div>`;
}

/* =========================================================================
   TABLE: Sortable model breakdown (Dashboard)
   ========================================================================= */

function renderModelTable(models) {
  const tbody = document.getElementById('model-table-body');
  if (!tbody) return;
  tbody.innerHTML = models.map((m, i) => `
    <tr>
      <td style="font-weight:600;color:#1A1A2E;">${shortModel(m.model)}</td>
      <td class="num">${fmt(m.avg_score, 3)}</td>
      <td class="num">${fmt(m.avg_latency, 2)}s</td>
      <td class="num">${fmtCost(m.avg_cost)}</td>
      <td class="num">${fmt(denormCS(Number(m.cs)), 4)}</td>
      <td class="num">${fmt(denormCS(Number(m.cd)), 2)}</td>
      <td class="num csi-value">${fmt(m.csi, 2)}</td>
    </tr>`).join('');
}

function initTableSort() {
  const table = document.getElementById('model-table');
  if (!table) return;
  const headers = table.querySelectorAll('th[data-sort]');
  // Set initial arrow on CSI column
  updateSortArrows(table, 'csi', false);

  headers.forEach(function(th) {
    th.addEventListener('click', function() {
      const col = th.getAttribute('data-sort');
      if (window._dashboardSortCol === col) {
        window._dashboardSortAsc = !window._dashboardSortAsc;
      } else {
        window._dashboardSortCol = col;
        window._dashboardSortAsc = false; // default desc for new column
      }
      var sorted = window._dashboardModels.slice().sort(function(a, b) {
        var va, vb;
        if (col === 'model') {
          va = shortModel(a.model).toLowerCase();
          vb = shortModel(b.model).toLowerCase();
          return window._dashboardSortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
        }
        va = Number(a[col]) || 0;
        vb = Number(b[col]) || 0;
        return window._dashboardSortAsc ? va - vb : vb - va;
      });
      renderModelTable(sorted);
      updateSortArrows(table, col, window._dashboardSortAsc);
    });
  });
}

function updateSortArrows(table, activeCol, asc) {
  table.querySelectorAll('th[data-sort]').forEach(function(th) {
    var arrow = th.querySelector('.sort-arrow');
    if (!arrow) return;
    if (th.getAttribute('data-sort') === activeCol) {
      arrow.textContent = asc ? ' \u25B2' : ' \u25BC';
      arrow.style.color = 'var(--accent-gold)';
    } else {
      arrow.textContent = '';
    }
  });
}

/* =========================================================================
   PAGE: index.html (Dashboard)
   ========================================================================= */

async function loadDashboard() {
  const heroNum = document.getElementById('hero-number');
  const heroDate = document.getElementById('hero-date');
  const statCS = document.getElementById('stat-cs');
  const statCD = document.getElementById('stat-cd');
  const statModels = document.getElementById('stat-models');
  const modelTable = document.getElementById('model-table-body');

  if (!heroNum) return; // not on dashboard page

  try {
    // Fetch latest aggregate index
    const agg = await sbFetch('csi_index', 'order=run_date.desc&limit=1');
    if (!agg.length) {
      heroNum.textContent = '—';
      heroDate.textContent = 'No benchmark data yet';
      if (statCS) statCS.textContent = '—';
      if (statCD) statCD.textContent = '—';
      if (statModels) statModels.textContent = '0';
      if (modelTable) showFallback(modelTable.closest('.table-wrap') || modelTable, 'Run the benchmark to see model-level results.');
      return;
    }

    const idx = agg[0];
    // Populate "Last run" timestamp
    const lastRunEl = document.getElementById('last-run');
    if (lastRunEl && idx.run_date) {
      lastRunEl.textContent = 'Last run: ' + idx.run_date;
    }
    const csiVal = normCSI(Number(idx.csi_aggregate));
    heroNum.textContent = csiVal.toFixed(2);
    heroDate.textContent = idx.run_date;
    if (statCS) statCS.textContent = fmt(denormCS(Number(idx.cs_aggregate)), 4);
    if (statCD) statCD.textContent = fmt(denormCS(Number(idx.cd_aggregate)), 2);
    // Fetch per-model breakdown for latest date, sorted by CSI descending
    const models = await sbFetch('csi_by_model', `run_date=eq.${idx.run_date}&order=csi.desc`);
    models.sort((a, b) => Number(b.csi) - Number(a.csi));
    if (statModels) statModels.textContent = models.length;
    // Store models for sorting
    window._dashboardModels = models;
    window._dashboardSortCol = 'csi';
    window._dashboardSortAsc = false;

    if (modelTable && models.length) {
      renderModelTable(models);
      initTableSort();
      // Populate callout spread
      const callout = document.getElementById('callout-insight');
      const spreadEl = document.getElementById('csi-spread');
      if (callout && spreadEl && models.length >= 2) {
        const csiValues = models.map(m => Number(m.csi));
        const maxCSI = Math.max(...csiValues);
        const minCSI = Math.min(...csiValues);
        const pointSpread = (maxCSI - minCSI).toFixed(2);
        spreadEl.textContent = pointSpread + '-point';
        callout.style.display = '';
      }
      // Populate efficiency spread line
      const effSpread = document.getElementById('efficiency-spread');
      if (effSpread && models.length >= 2) {
        const csiVals = models.map(m => ({ name: shortModel(m.model), csi: Number(m.csi) }));
        const best = csiVals.reduce((a, b) => a.csi > b.csi ? a : b);
        const worst = csiVals.reduce((a, b) => a.csi < b.csi ? a : b);
        const pointSpread = (best.csi - worst.csi).toFixed(2);
        const ratio = (best.csi / worst.csi).toFixed(2);
        effSpread.querySelector('span').innerHTML =
          '<span style="color:var(--accent-gold);font-family:var(--font-mono);font-weight:600;">' + pointSpread + '-point</span> (<span style="color:var(--accent-gold);font-family:var(--font-mono);font-weight:600;">' + ratio + '\u00d7</span>) efficiency spread across today\u2019s frontier AI models';
        var effDetail = document.getElementById('efficiency-spread-detail');
        if (effDetail) {
          effDetail.textContent =
            best.name + ' CSI: ' + fmt(best.csi, 2) + ' \u2212 ' +
            worst.name + ' CSI: ' + fmt(worst.csi, 2) + ' = ' + pointSpread + ' points';
        }
        effSpread.style.display = '';
      }
    } else if (modelTable) {
      showFallback(modelTable.closest('.table-wrap') || modelTable, 'No per-model data available.');
    }

    // Check for previous date to show delta
    const prev = await sbFetch('csi_index', 'order=run_date.desc&limit=1&offset=1');
    const deltaBadge = document.getElementById('hero-delta');
    if (deltaBadge && prev.length) {
      const prevCSI = normCSI(Number(prev[0].csi_aggregate));
      if (prevCSI > 0) {
        const delta = csiVal - prevCSI;
        const pctChange = ((csiVal - prevCSI) / Math.abs(prevCSI)) * 100;
        deltaBadge.className = `badge ${delta >= 0 ? 'badge-green' : 'badge-red'}`;
        const sign = pctChange >= 0 ? '+' : '';
        deltaBadge.textContent = (delta >= 0 ? '\u25B2 ' : '\u25BC ') + sign + pctChange.toFixed(1) + '% vs prev';
      }
    }
  } catch (err) {
    console.error('Dashboard load error:', err);
    heroNum.textContent = '—';
    heroDate.textContent = 'Error loading data';
  }
}

/* =========================================================================
   CHART: CSI Over Time (visualize.html)
   ========================================================================= */

async function loadCSIChart() {
  const canvas = document.getElementById('csi-chart');
  if (!canvas || typeof Chart === 'undefined') return;

  try {
    const history = await sbFetch('csi_index', 'select=run_date,csi_aggregate&order=run_date.asc');
    if (!history.length) return;

    const labels = history.map(r => r.run_date);
    const raw = history.map(r => normCSI(Number(r.csi_aggregate)));

    // Use 7-day rolling average when we have enough data points
    const values = raw.length >= 7 ? raw.map(function(_, i, arr) {
      if (i < 6) return arr[i];
      var sum = 0;
      for (var j = i - 6; j <= i; j++) sum += arr[j];
      return sum / 7;
    }) : raw;

    new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'CSI Aggregate',
          data: values,
          borderColor: '#2a9d6e',
          backgroundColor: 'rgba(42,157,110,0.1)',
          fill: true,
          tension: 0.3,
          pointRadius: values.length === 1 ? 6 : 3,
          pointBackgroundColor: '#2a9d6e',
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false },
        },
        scales: {
          x: {
            ticks: { color: cssVar('--text-primary') },
            grid: { color: 'rgba(0,0,0,0.06)' },
          },
          y: {
            ticks: { color: cssVar('--text-primary') },
            grid: { color: 'rgba(0,0,0,0.06)' },
            beginAtZero: false,
          }
        }
      }
    });
  } catch (err) {
    console.error('Chart load error:', err);
  }
}

/* =========================================================================
   CHART: Dashboard cost-per-task (index.html)
   ========================================================================= */

let _dashCostCharts = [];

async function loadDashboardCost() {
  const section = document.getElementById('dash-cost');
  if (!section || typeof Chart === 'undefined') return;

  try {
    // Fetch pricing
    const pricingRows = await sbFetch('pricing', 'select=model,input_price_per_million,output_price_per_million&order=snapshot_date.desc');
    if (!pricingRows.length) return;
    const seen = {};
    const pricing = [];
    for (const r of pricingRows) {
      if (!seen[r.model]) { seen[r.model] = true; pricing.push(r); }
    }

    // Fetch CSI for tier colors
    const agg = await sbFetch('csi_index', 'order=run_date.desc&limit=1');
    const csiMap = {};
    if (agg.length) {
      const models = await sbFetch('csi_by_model', `run_date=eq.${agg[0].run_date}`);
      for (const m of models) csiMap[m.model] = Number(m.csi);
    }

    // Destroy previous
    for (const c of _dashCostCharts) c.destroy();
    _dashCostCharts = [];

    const TASKS = [
      { canvasId: 'dash-chart-10k', insightId: 'dash-insight-10k', inputTokens: 80000, outputTokens: 2000, taskVerb: "Summarizing NVIDIA\u2019s 10-K" },
      { canvasId: 'dash-chart-dcf', insightId: 'dash-insight-dcf', inputTokens: 1500, outputTokens: 8000, taskVerb: "Building a DCF model" },
      { canvasId: 'dash-chart-legal', insightId: 'dash-insight-legal', inputTokens: 12000, outputTokens: 1500, taskVerb: "Summarizing a legal contract" },
    ];

    const spreads = [];

    for (const task of TASKS) {
      const canvas = document.getElementById(task.canvasId);
      if (!canvas) continue;

      const data = pricing.map(p => {
        const inPrice = Number(p.input_price_per_million);
        const outPrice = Number(p.output_price_per_million);
        const costPerTask = (task.inputTokens / 1e6 * inPrice) + (task.outputTokens / 1e6 * outPrice);
        return { name: shortModel(p.model), cost: costPerTask, csi: csiMap[p.model] || 0 };
      }).filter(d => d.cost > 0).sort((a, b) => a.cost - b.cost);

      if (!data.length) continue;

      const cheapest = data[0];
      const priciest = data[data.length - 1];
      if (data.length >= 2) spreads.push(priciest.cost / cheapest.cost);

      const insightEl = document.getElementById(task.insightId);
      if (insightEl && data.length >= 2) {
        const spread = Math.round(priciest.cost / cheapest.cost);
        insightEl.innerHTML = '<strong>' + task.taskVerb + ' costs ' + spread + '\u00d7 more on ' + priciest.name + ' (' + fmtTaskCost(priciest.cost) + ') than on ' + cheapest.name + ' (' + fmtTaskCost(cheapest.cost) + ').</strong>';
        insightEl.style.display = '';
      }

      const labels = data.map(d => d.name);
      const values = data.map(d => d.cost);
      const colors = data.map(d => csiTierColor(d.csi) + 'cc');

      const chart = new Chart(canvas, {
        type: 'bar',
        data: { labels, datasets: [{ data: values, backgroundColor: colors, borderColor: data.map(d => csiTierColor(d.csi)), borderWidth: 1, borderRadius: 3 }] },
        options: {
          indexAxis: 'y', responsive: true,
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: function(ctx) { return fmtTaskCost(ctx.parsed.x) + ' per task'; } } } },
          scales: {
            x: { type: 'logarithmic', title: { display: true, text: 'Cost per task (USD, log scale)', color: cssVar('--text-primary'), font: { size: 13 } }, ticks: { color: cssVar('--text-primary'), callback: function(val) { if ([0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5].includes(val)) return '$' + val; return ''; } }, grid: { color: 'rgba(0,0,0,0.06)' } },
            y: { ticks: { color: cssVar('--text-primary'), font: { size: 12 } }, grid: { display: false } }
          },
          layout: { padding: { right: 65 } },
          animation: { onComplete: function() { const ch = this; const cx = ch.ctx; cx.font = '12px "IBM Plex Mono", monospace'; cx.fillStyle = cssVar('--text-primary'); cx.textAlign = 'left'; cx.textBaseline = 'middle'; const meta = ch.getDatasetMeta(0); meta.data.forEach(function(bar, i) { cx.fillText(fmtTaskCost(values[i]), bar.x + 4, bar.y); }); } }
        }
      });
      _dashCostCharts.push(chart);
    }

    const avgInsightEl = document.getElementById('dash-insight-avg');
    if (avgInsightEl && spreads.length) {
      const avgSpread = Math.round(spreads.reduce((a, b) => a + b, 0) / spreads.length);
      avgInsightEl.innerHTML = '<strong>Across these three tasks, the most expensive model costs an average of ' + avgSpread + '\u00d7 more per task than the cheapest.</strong>';
      avgInsightEl.style.display = '';
    }

    section.style.display = '';
  } catch (err) {
    console.error('Dashboard cost load error:', err);
  }
}

/* =========================================================================
   CHART: CSI Forward Curve (index.html)
   ========================================================================= */

async function loadForwardChart() {
  const canvas = document.getElementById('forward-chart');
  if (!canvas || typeof Chart === 'undefined') return;

  try {
    // Fetch current CSI aggregate (the "Now" point)
    const aggRows = await sbFetch('csi_index', 'select=csi_aggregate&order=run_date.desc&limit=1');
    const currentCSI = aggRows.length ? normCSI(Number(aggRows[0].csi_aggregate)) : null;

    // Fetch latest run_date from forward curve, then fetch that date's rows
    const dateRows = await sbFetch('csi_forward_curve', 'select=run_date&order=run_date.desc&limit=1');
    if (!dateRows.length) return;
    const latestDate = dateRows[0].run_date;

    const rows = await sbFetch('csi_forward_curve',
      `select=horizon_months,scenario,projected_csi,confidence_lower,confidence_upper&run_date=eq.${latestDate}`);

    const horizons = [3, 6, 12, 24];
    const xLabels = ['Now', '+3 mo', '+6 mo', '+12 mo', '+24 mo'];

    function extractSeries(scenario) {
      const pts = [currentCSI];
      const lo = [currentCSI];
      const hi = [currentCSI];
      for (const h of horizons) {
        const r = rows.find(d => d.horizon_months === h && d.scenario === scenario);
        pts.push(r ? Number(r.projected_csi) : null);
        lo.push(r ? Number(r.confidence_lower) : null);
        hi.push(r ? Number(r.confidence_upper) : null);
      }
      return { pts, lo, hi };
    }

    const below = extractSeries('below_trend');
    const hist  = extractSeries('historical_trend');
    const above = extractSeries('above_trend');

    new Chart(canvas, {
      type: 'line',
      data: {
        labels: xLabels,
        datasets: [
          // Confidence bands (upper bounds, filled down to lower bounds)
          {
            label: '_above_upper',
            data: above.hi,
            borderColor: 'transparent',
            backgroundColor: 'rgba(81,207,102,0.10)',
            fill: '+1',
            pointRadius: 0,
            tension: 0.3,
          },
          {
            label: '_above_lower',
            data: above.lo,
            borderColor: 'transparent',
            backgroundColor: 'transparent',
            fill: false,
            pointRadius: 0,
            tension: 0.3,
          },
          {
            label: '_hist_upper',
            data: hist.hi,
            borderColor: 'transparent',
            backgroundColor: 'rgba(224,224,224,0.10)',
            fill: '+1',
            pointRadius: 0,
            tension: 0.3,
          },
          {
            label: '_hist_lower',
            data: hist.lo,
            borderColor: 'transparent',
            backgroundColor: 'transparent',
            fill: false,
            pointRadius: 0,
            tension: 0.3,
          },
          {
            label: '_below_upper',
            data: below.hi,
            borderColor: 'transparent',
            backgroundColor: 'rgba(255,107,107,0.10)',
            fill: '+1',
            pointRadius: 0,
            tension: 0.3,
          },
          {
            label: '_below_lower',
            data: below.lo,
            borderColor: 'transparent',
            backgroundColor: 'transparent',
            fill: false,
            pointRadius: 0,
            tension: 0.3,
          },
          // Main lines
          {
            label: 'Above-Trend',
            data: above.pts,
            borderColor: '#51cf66',
            backgroundColor: '#51cf66',
            borderWidth: 2.5,
            fill: false,
            tension: 0.3,
            pointRadius: 4,
            pointBackgroundColor: '#51cf66',
          },
          {
            label: 'Historical Trend',
            data: hist.pts,
            borderColor: '#e0e0e0',
            backgroundColor: '#e0e0e0',
            borderWidth: 2.5,
            fill: false,
            tension: 0.3,
            pointRadius: 4,
            pointBackgroundColor: '#e0e0e0',
          },
          {
            label: 'Below-Trend',
            data: below.pts,
            borderColor: '#ff6b6b',
            backgroundColor: '#ff6b6b',
            borderWidth: 2.5,
            fill: false,
            tension: 0.3,
            pointRadius: 4,
            pointBackgroundColor: '#ff6b6b',
          },
        ]
      },
      options: {
        responsive: true,
        plugins: {
          legend: {
            display: true,
            position: 'top',
            labels: {
              color: cssVar('--text-secondary'),
              usePointStyle: true,
              pointStyle: 'line',
              padding: 20,
              font: { size: 13 },
              filter: function(item) {
                return !item.text.startsWith('_');
              },
              generateLabels: function(chart) {
                const defaults = Chart.defaults.plugins.legend.labels.generateLabels(chart);
                return defaults.filter(l => !l.text.startsWith('_')).map(function(l) {
                  if (l.text === 'Above-Trend' || l.text === 'Historical Trend' || l.text === 'Below-Trend') {
                    l.fontColor = cssVar('--text-primary');
                  }
                  return l;
                });
              }
            }
          },
          tooltip: {
            callbacks: {
              label: function(ctx) {
                if (ctx.dataset.label.startsWith('_')) return null;
                return ctx.dataset.label + ': ' + fmt(ctx.parsed.y, 2);
              }
            }
          }
        },
        scales: {
          x: {
            ticks: { color: cssVar('--text-tertiary'), font: { size: 13 } },
            grid: { color: 'rgba(0,0,0,0.06)' },
          },
          y: {
            title: { display: true, text: 'Projected CSI Aggregate', color: cssVar('--text-tertiary'), font: { size: 13 } },
            ticks: { color: cssVar('--text-tertiary') },
            grid: { color: 'rgba(0,0,0,0.06)' },
            beginAtZero: false,
          }
        }
      }
    });
  } catch (err) {
    console.error('Forward chart load error:', err);
  }
}

/* =========================================================================
   PAGE: research.html (Dynamic efficiency spread)
   ========================================================================= */

async function loadResearchSpread() {
  const detailEl = document.getElementById('research-spread-detail');
  if (!detailEl) return; // not on research page

  try {
    const agg = await sbFetch('csi_index', 'order=run_date.desc&limit=1');
    if (!agg.length) return;

    const models = await sbFetch('csi_by_model', `run_date=eq.${agg[0].run_date}&order=csi.desc`);
    if (models.length < 2) return;

    const csiVals = models.map(m => ({ name: shortModel(m.model), csi: Number(m.csi) }));
    const best = csiVals.reduce((a, b) => a.csi > b.csi ? a : b);
    const worst = csiVals.reduce((a, b) => a.csi < b.csi ? a : b);
    if (worst.csi <= 0) return;

    const pointSpread = (best.csi - worst.csi).toFixed(2);
    detailEl.textContent =
      best.name + ' CSI: ' + fmt(best.csi, 2) + ' \u2212 ' +
      worst.name + ' CSI: ' + fmt(worst.csi, 2) + ' = ' + pointSpread + ' points';
  } catch (err) {
    console.error('Research spread load error:', err);
    // fallback: keep static value
  }
}

/* =========================================================================
   PAGE: data.html (Raw measurements)
   ========================================================================= */

async function loadDataPage() {
  const tbody = document.getElementById('data-table-body');
  const dateSelect = document.getElementById('date-select');
  if (!tbody) return;

  try {
    // Get available dates
    const allDates = await sbFetch('csi_index', 'select=run_date&order=run_date.desc');
    if (!allDates.length) {
      showFallback(tbody.closest('.table-wrap') || tbody.parentElement, null);
      return;
    }

    if (dateSelect) {
      dateSelect.innerHTML = allDates.map(d =>
        `<option value="${d.run_date}">${d.run_date}</option>`
      ).join('');
      dateSelect.addEventListener('change', () => loadMeasurements(tbody, dateSelect.value));
    }

    await loadMeasurements(tbody, allDates[0].run_date);
  } catch (err) {
    console.error('Data page error:', err);
    showFallback(tbody.closest('.table-wrap') || tbody.parentElement, 'Error loading measurements.');
  }
}

async function loadMeasurements(tbody, runDate) {
  const rows = await sbFetch('measurements', `run_date=eq.${runDate}&select=model,task_id,domain,score,latency_seconds,prompt_tokens,completion_tokens,cost_dollars&order=model,task_id`);
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-tertiary);">No measurements for this date.</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(r => `
    <tr>
      <td class="model-name">${shortModel(r.model)}</td>
      <td>${r.task_id}</td>
      <td>${r.domain}</td>
      <td class="num">${fmt(r.score, 2)}</td>
      <td class="num">${fmt(r.latency_seconds, 2)}s</td>
      <td class="num">${r.prompt_tokens}+${r.completion_tokens}</td>
      <td class="num">${fmtCost(r.cost_dollars)}</td>
    </tr>`).join('');
}

/* =========================================================================
   CSV Downloads (data.html)
   ========================================================================= */

function downloadCSV(data, filename) {
  if (!data || !data.length) return;
  const headers = Object.keys(data[0]);
  const csv = [
    headers.join(','),
    ...data.map(row => headers.map(h => {
      const val = row[h];
      if (typeof val === 'string' && (val.includes(',') || val.includes('"'))) {
        return '"' + val.replace(/"/g, '""') + '"';
      }
      return val == null ? '' : val;
    }).join(','))
  ].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

let _spotData = null;

function wireDownloadButtons() {
  const btnSpot = document.getElementById('btn-spot-csv');
  const btnForward = document.getElementById('btn-forward-csv');
  if (!btnSpot) return;

  // Load spot data, normalize historical values, and enable button
  sbFetch('csi_by_model', 'order=run_date.desc,csi.desc').then(data => {
    _spotData = data.map(row => {
      var r = Object.assign({}, row);
      r.cs = denormCS(Number(r.cs));
      r.cd = denormCS(Number(r.cd));
      r.csi = normCSI(Number(r.csi));
      return r;
    });
    if (data.length) btnSpot.disabled = false;
  }).catch(() => {});

  btnSpot.addEventListener('click', () => {
    if (_spotData) {
      downloadCSV(_spotData, 'csi_spot_' + new Date().toISOString().slice(0, 10) + '.csv');
    }
  });

  btnForward.addEventListener('click', async () => {
    try {
      btnForward.disabled = true;
      btnForward.textContent = 'Fetching\u2026';
      const forward = await sbFetch('csi_forward_curve', 'order=run_date.desc');
      const normalized = forward.map(row => {
        var r = Object.assign({}, row);
        if (r.projected_csi != null) r.projected_csi = normCSI(Number(r.projected_csi));
        if (r.confidence_lower != null) r.confidence_lower = normCSI(Number(r.confidence_lower));
        if (r.confidence_upper != null) r.confidence_upper = normCSI(Number(r.confidence_upper));
        return r;
      });
      downloadCSV(normalized, 'csi_forward_curve_' + new Date().toISOString().slice(0, 10) + '.csv');
    } catch (err) {
      console.error('Forward curve fetch error:', err);
      alert('Forward curve data not available yet.');
    } finally {
      btnForward.disabled = false;
      btnForward.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12l7 7 7-7"/></svg> Download forward curve (CSV)';
    }
  });
}

/* =========================================================================
   PAGE: visualize.html
   ========================================================================= */

// Chart instance refs for cleanup on redraw
let _frontierChart = null;
let _vizDollarCharts = [];

// Cached pricing (doesn't change with date)
let _vizPricing = null;

async function loadVisualizations() {
  const dateSelect = document.getElementById('viz-date-select');
  if (!dateSelect) return; // not on visualize page

  try {
    // Get available dates
    const allDates = await sbFetch('csi_index', 'select=run_date&order=run_date.desc');
    if (!allDates.length) return;

    dateSelect.innerHTML = allDates.map(d =>
      `<option value="${d.run_date}">${d.run_date}</option>`
    ).join('');

    // Load pricing once
    const pricingRows = await sbFetch('pricing', 'select=model,input_price_per_million,output_price_per_million&order=snapshot_date.desc');
    const seen = {};
    _vizPricing = [];
    for (const r of pricingRows) {
      if (!seen[r.model]) {
        seen[r.model] = true;
        _vizPricing.push(r);
      }
    }

    // Initial draw
    await drawVisualizations(allDates[0].run_date);

    // Redraw on date change
    dateSelect.addEventListener('change', () => drawVisualizations(dateSelect.value));
  } catch (err) {
    console.error('Visualizations load error:', err);
  }
}

async function drawVisualizations(runDate) {
  try {
    const models = await sbFetch('csi_by_model', `run_date=eq.${runDate}&order=csi.desc`);
    if (!models.length) return;

    drawFrontier(models);
    drawTreemap(models);
    drawDistributions(models);
    drawDollarCharts(models);
  } catch (err) {
    console.error('Draw visualizations error:', err);
  }
}

/* --- Section 1: Efficiency Frontier --- */

function drawFrontier(models) {
  const canvas = document.getElementById('frontier-chart');
  const section = document.getElementById('viz-frontier');
  if (!canvas || typeof Chart === 'undefined') return;

  if (_frontierChart) { _frontierChart.destroy(); _frontierChart = null; }

  const data = models.map(m => ({
    x: Number(m.avg_cost),
    y: Number(m.avg_score),
    r: Math.max(Number(m.csi) * 6, 6),
    csi: Number(m.csi),
    name: shortModel(m.model),
    latency: Number(m.avg_latency),
    color: csiTierColor(Number(m.csi)),
  }));

  // Auto-calculate y-axis range from data, with padding for bubble radius
  const scores = data.map(d => d.y);
  const yMin = Math.max(0, Math.min(...scores) - 0.08);
  const yMax = Math.max(...scores) + 0.08;

  // Build legend
  const legendEl = document.getElementById('frontier-legend');
  if (legendEl) {
    const tiers = [
      { color: '#1D9E75', label: 'CSI 6+' },
      { color: '#378ADD', label: 'CSI 4\u20136' },
      { color: '#BA7517', label: 'CSI 2\u20134' },
      { color: '#A32D2D', label: 'CSI < 2' },
    ];
    legendEl.innerHTML = tiers.map(t =>
      `<span style="display:inline-flex;align-items:center;gap:0.4rem;font-size:0.82rem;color:var(--text-primary);">` +
      `<span style="width:12px;height:12px;border-radius:50%;background:${t.color};display:inline-block;"></span>${t.label}</span>`
    ).join('');
  }

  _frontierChart = new Chart(canvas, {
    type: 'bubble',
    data: {
      datasets: [{
        data: data,
        backgroundColor: data.map(d => d.color + 'cc'),
        borderColor: data.map(d => d.color),
        borderWidth: 1.5,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      aspectRatio: 2.2,
      layout: { padding: { top: 40, right: 30, bottom: 10, left: 10 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: function(ctx) {
              const d = data[ctx.dataIndex];
              return [
                d.name,
                'CSI: ' + fmt(d.csi, 2),
                'Cost/task: $' + fmt(d.x, 6),
                'Capability: ' + fmt(d.y, 3),
                'Latency: ' + fmt(d.latency, 2) + 's',
              ];
            }
          }
        }
      },
      scales: {
        x: {
          type: 'logarithmic',
          title: { display: true, text: 'Cost per task ($, log scale)', color: cssVar('--text-primary'), font: { size: 13 } },
          ticks: {
            color: cssVar('--text-primary'),
            callback: function(val) { return '$' + val; }
          },
          grid: { color: 'rgba(0,0,0,0.06)' },
        },
        y: {
          title: { display: true, text: 'Capability Score', color: cssVar('--text-primary'), font: { size: 13 } },
          ticks: {
            color: cssVar('--text-primary'),
            callback: function(val) { return val <= 1 ? val : ''; }
          },
          grid: { color: 'rgba(0,0,0,0.06)' },
          min: yMin,
          max: yMax,
        }
      },
      animation: {
        onComplete: function() {
          const chart = this;
          const ctx = chart.ctx;
          ctx.font = '11px "IBM Plex Mono", monospace';
          ctx.fillStyle = cssVar('--text-primary');
          ctx.textAlign = 'center';
          const meta = chart.getDatasetMeta(0);
          // Collect label positions to avoid overlaps
          const placed = [];
          meta.data.forEach(function(point, i) {
            const d = data[i];
            var labelY = point.y - d.r - 8;
            // Check for overlap with already placed labels
            for (var j = 0; j < placed.length; j++) {
              if (Math.abs(point.x - placed[j].x) < 55 && Math.abs(labelY - placed[j].y) < 12) {
                labelY = placed[j].y - 13;
              }
            }
            ctx.fillText(d.name, point.x, labelY);
            placed.push({ x: point.x, y: labelY });
          });
        }
      }
    }
  });

  section.style.display = '';
}

/* --- Section 2: Treemap --- */

function drawTreemap(models) {
  const container = document.getElementById('treemap-container');
  const section = document.getElementById('viz-treemap');
  if (!container || typeof d3 === 'undefined') return;

  // Show section first so container has dimensions
  section.style.display = '';
  container.innerHTML = '';

  const width = container.clientWidth || 800;
  const height = 480;

  const treeData = {
    name: 'root',
    children: models.map(m => ({
      name: shortModel(m.model),
      value: Math.max(Number(m.csi), 0.01),
      csi: Number(m.csi),
    }))
  };

  const root = d3.hierarchy(treeData)
    .sum(d => d.value)
    .sort((a, b) => b.value - a.value);

  d3.treemap()
    .size([width, height])
    .padding(2)
    .round(true)(root);

  const svg = d3.select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .attr('viewBox', `0 0 ${width} ${height}`);

  const leaves = svg.selectAll('g')
    .data(root.leaves())
    .join('g')
    .attr('transform', d => `translate(${d.x0},${d.y0})`);

  leaves.append('rect')
    .attr('width', d => d.x1 - d.x0)
    .attr('height', d => d.y1 - d.y0)
    .attr('fill', d => csiTierColor(d.data.csi))
    .attr('fill-opacity', 0.85)
    .attr('rx', 3)
    .attr('stroke', '#FFFFFF')
    .attr('stroke-width', 1);

  // Labels — only show if rectangle is large enough
  leaves.each(function(d) {
    const w = d.x1 - d.x0;
    const h = d.y1 - d.y0;
    const g = d3.select(this);

    if (w > 50 && h > 30) {
      g.append('text')
        .attr('x', (w) / 2)
        .attr('y', (h) / 2 - 7)
        .attr('text-anchor', 'middle')
        .attr('fill', '#fff')
        .attr('font-family', '"IBM Plex Mono", monospace')
        .attr('font-size', w > 100 ? '13px' : '11px')
        .text(d.data.name);

      g.append('text')
        .attr('x', (w) / 2)
        .attr('y', (h) / 2 + 10)
        .attr('text-anchor', 'middle')
        .attr('fill', 'rgba(255,255,255,0.7)')
        .attr('font-family', '"IBM Plex Mono", monospace')
        .attr('font-size', w > 100 ? '12px' : '10px')
        .text('CSI ' + fmt(d.data.csi, 1));
    }
  });

  // Tooltip
  leaves.append('title')
    .text(d => d.data.name + '\nCSI: ' + fmt(d.data.csi, 2));
}

/* --- Section 3: What does one task cost? --- */

function drawDollarCharts(models) {
  const section = document.getElementById('viz-dollar');
  if (!section || typeof Chart === 'undefined' || !_vizPricing) return;

  // Destroy previous charts
  for (const c of _vizDollarCharts) { c.destroy(); }
  _vizDollarCharts = [];

  // Build CSI lookup from models
  const csiMap = {};
  for (const m of models) {
    csiMap[m.model] = Number(m.csi);
  }

  const TASKS = [
    { canvasId: 'viz-chart-10k', insightId: 'viz-insight-10k', inputTokens: 80000, outputTokens: 2000, taskVerb: "Summarizing NVIDIA\u2019s 10-K" },
    { canvasId: 'viz-chart-dcf', insightId: 'viz-insight-dcf', inputTokens: 1500, outputTokens: 8000, taskVerb: "Building a DCF model" },
    { canvasId: 'viz-chart-legal', insightId: 'viz-insight-legal', inputTokens: 12000, outputTokens: 1500, taskVerb: "Summarizing a legal contract" },
  ];

  const spreads = [];

  for (const task of TASKS) {
    const canvas = document.getElementById(task.canvasId);
    if (!canvas) continue;

    const data = _vizPricing.map(p => {
      const inPrice = Number(p.input_price_per_million);
      const outPrice = Number(p.output_price_per_million);
      const costPerTask = (task.inputTokens / 1e6 * inPrice) + (task.outputTokens / 1e6 * outPrice);
      return {
        name: shortModel(p.model),
        cost: costPerTask,
        csi: csiMap[p.model] || 0,
      };
    }).filter(d => d.cost > 0)
      .sort((a, b) => a.cost - b.cost); // cheapest at top

    if (!data.length) continue;

    const cheapest = data[0];
    const priciest = data[data.length - 1];

    if (data.length >= 2) {
      spreads.push(priciest.cost / cheapest.cost);
    }

    // Per-task insight
    const insightEl = document.getElementById(task.insightId);
    if (insightEl && data.length >= 2) {
      const spread = Math.round(priciest.cost / cheapest.cost);
      insightEl.innerHTML = '<strong>' + task.taskVerb + ' costs ' + spread + '\u00d7 more on ' + priciest.name + ' (' + fmtTaskCost(priciest.cost) + ') than on ' + cheapest.name + ' (' + fmtTaskCost(cheapest.cost) + ').</strong>';
      insightEl.style.display = '';
    }

    const labels = data.map(d => d.name);
    const values = data.map(d => d.cost);
    const colors = data.map(d => csiTierColor(d.csi) + 'cc');

    const chart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor: colors,
          borderColor: data.map(d => csiTierColor(d.csi)),
          borderWidth: 1,
          borderRadius: 3,
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function(ctx) {
                return fmtTaskCost(ctx.parsed.x) + ' per task';
              }
            }
          }
        },
        scales: {
          x: {
            type: 'logarithmic',
            title: { display: true, text: 'Cost per task (USD, log scale)', color: cssVar('--text-primary'), font: { size: 13 } },
            ticks: {
              color: cssVar('--text-primary'),
              callback: function(val) {
                if ([0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5].includes(val)) {
                  return '$' + val;
                }
                return '';
              }
            },
            grid: { color: 'rgba(0,0,0,0.06)' },
          },
          y: {
            ticks: { color: cssVar('--text-primary'), font: { size: 12 } },
            grid: { display: false },
          }
        },
        layout: { padding: { right: 65 } },
        animation: {
          onComplete: function() {
            const ch = this;
            const cx = ch.ctx;
            cx.font = '12px "IBM Plex Mono", monospace';
            cx.fillStyle = cssVar('--text-primary');
            cx.textAlign = 'left';
            cx.textBaseline = 'middle';
            const meta = ch.getDatasetMeta(0);
            meta.data.forEach(function(bar, i) {
              cx.fillText(fmtTaskCost(values[i]), bar.x + 4, bar.y);
            });
          }
        }
      }
    });

    _vizDollarCharts.push(chart);
  }

  // Average spread insight
  const avgInsightEl = document.getElementById('viz-insight-avg');
  if (avgInsightEl && spreads.length) {
    const avgSpread = Math.round(spreads.reduce((a, b) => a + b, 0) / spreads.length);
    avgInsightEl.innerHTML = '<strong>Across these three tasks, the most expensive model costs an average of ' + avgSpread + '\u00d7 more per task than the cheapest.</strong>';
    avgInsightEl.style.display = '';
  }

  section.style.display = '';
}

/* =========================================================================
   CHART: Distribution histograms (visualize.html)
   ========================================================================= */

let _distCharts = [];

function drawDistributions(models) {
  var section = document.getElementById('viz-distribution');
  if (!section || typeof Chart === 'undefined') return;

  for (var c of _distCharts) c.destroy();
  _distCharts = [];

  // --- CSI Distribution ---
  var csiCanvas = document.getElementById('viz-dist-csi');
  if (csiCanvas) {
    var csiValues = models.map(function(m) { return Number(m.csi); }).sort(function(a, b) { return a - b; });
    var valMin = Math.floor(Math.min.apply(null, csiValues));
    var valMax = Math.ceil(Math.max.apply(null, csiValues));
    var binCount = 8;
    var binWidth = (valMax - valMin) / binCount;
    if (binWidth === 0) binWidth = 1;
    var bins = [];
    for (var i = 0; i < binCount; i++) {
      bins.push({ lo: valMin + i * binWidth, hi: valMin + (i + 1) * binWidth, count: 0 });
    }
    for (var j = 0; j < csiValues.length; j++) {
      var v = csiValues[j];
      for (var k = 0; k < bins.length; k++) {
        if (v >= bins[k].lo && (v < bins[k].hi || k === bins.length - 1)) { bins[k].count++; break; }
      }
    }
    var medianCSI = csiValues[Math.floor(csiValues.length / 2)];
    var labels = bins.map(function(b) { return b.lo.toFixed(1) + '-' + b.hi.toFixed(1); });
    var counts = bins.map(function(b) { return b.count; });
    var colors = bins.map(function(_, idx) {
      var t = idx / (bins.length - 1);
      var r = Math.round(59 + t * (29 - 59));
      var g = Math.round(130 + t * (158 - 130));
      var b = Math.round(246 + t * (117 - 246));
      return 'rgb(' + r + ',' + g + ',' + b + ')';
    });

    var chart1 = new Chart(csiCanvas, {
      type: 'bar',
      data: { labels: labels, datasets: [{ data: counts, backgroundColor: colors, borderRadius: 3 }] },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false },
          annotation: undefined
        },
        scales: {
          x: { title: { display: true, text: 'CSI range (log scale)', color: '#1A1A2E', font: { size: 12 } }, ticks: { color: '#1A1A2E', font: { size: 10 } }, grid: { display: false } },
          y: { title: { display: true, text: 'Models', color: '#1A1A2E', font: { size: 12 } }, ticks: { color: '#1A1A2E', stepSize: 1 }, grid: { color: 'rgba(0,0,0,0.06)' }, beginAtZero: true }
        }
      }
    });
    _distCharts.push(chart1);
  }

  // --- Cost Distribution ---
  var costCanvas = document.getElementById('viz-dist-cost');
  if (costCanvas && _vizPricing) {
    var costs = _vizPricing.map(function(p) {
      return (80000 / 1e6 * Number(p.input_price_per_million)) + (2000 / 1e6 * Number(p.output_price_per_million));
    }).filter(function(c) { return c > 0; }).sort(function(a, b) { return a - b; });

    var costLogVals = costs.map(function(c) { return Math.log10(c); });
    var cLogMin = Math.floor(Math.min.apply(null, costLogVals));
    var cLogMax = Math.ceil(Math.max.apply(null, costLogVals));
    var cBinCount = 8;
    var cBinWidth = (cLogMax - cLogMin) / cBinCount;
    var cBins = [];
    for (var ci = 0; ci < cBinCount; ci++) {
      cBins.push({ lo: Math.pow(10, cLogMin + ci * cBinWidth), hi: Math.pow(10, cLogMin + (ci + 1) * cBinWidth), count: 0 });
    }
    for (var cj = 0; cj < costs.length; cj++) {
      for (var ck = 0; ck < cBins.length; ck++) {
        if (costs[cj] >= cBins[ck].lo && (costs[cj] < cBins[ck].hi || ck === cBins.length - 1)) { cBins[ck].count++; break; }
      }
    }
    var cLabels = cBins.map(function(b) { return '$' + (b.lo < 0.01 ? b.lo.toFixed(3) : b.lo < 1 ? b.lo.toFixed(2) : b.lo.toFixed(0)); });
    var cCounts = cBins.map(function(b) { return b.count; });
    var cColors = cBins.map(function(_, idx) {
      var t = idx / (cBins.length - 1);
      var r = Math.round(29 + t * (239 - 29));
      var g = Math.round(158 + t * (68 - 158));
      var b = Math.round(117 + t * (68 - 117));
      return 'rgb(' + r + ',' + g + ',' + b + ')';
    });

    var chart2 = new Chart(costCanvas, {
      type: 'bar',
      data: { labels: cLabels, datasets: [{ data: cCounts, backgroundColor: cColors, borderRadius: 3 }] },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          x: { title: { display: true, text: 'Cost per task (10-K summarization)', color: '#1A1A2E', font: { size: 12 } }, ticks: { color: '#1A1A2E', font: { size: 10 } }, grid: { display: false } },
          y: { title: { display: true, text: 'Models', color: '#1A1A2E', font: { size: 12 } }, ticks: { color: '#1A1A2E', stepSize: 1 }, grid: { color: 'rgba(0,0,0,0.06)' }, beginAtZero: true }
        }
      }
    });
    _distCharts.push(chart2);
  }

  section.style.display = '';
}

/* =========================================================================
   Boot
   ========================================================================= */

document.addEventListener('DOMContentLoaded', () => {
  loadDashboard();
  loadDashboardCost();
  loadCSIChart();
  loadForwardChart();
  loadResearchSpread();
  loadDataPage();
  wireDownloadButtons();
  loadVisualizations();
});
