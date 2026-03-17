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

/* — Generic fetch helper — */
async function sbFetch(table, params = '') {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${params}`;
  const resp = await fetch(url, { headers: HEADERS });
  if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
  return resp.json();
}

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

/* — Show fallback when no data — */
function showFallback(el, msg) {
  el.innerHTML = `
    <div class="fallback">
      <div class="fallback-icon">&#9711;</div>
      <p>${msg || 'No data available yet. Run the benchmark harness to generate measurements.'}</p>
    </div>`;
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
    const csiVal = Number(idx.csi_aggregate);
    const intPart = Math.floor(csiVal);
    const decPart = csiVal.toFixed(2).split('.')[1];
    heroNum.innerHTML = `${intPart}<span class="decimal">.${decPart}</span>`;
    heroDate.textContent = idx.run_date;
    if (statCS) statCS.textContent = fmt(idx.cs_aggregate, 4);
    if (statCD) statCD.textContent = fmt(idx.cd_aggregate, 2);
    // Fetch per-model breakdown for latest date, sorted by CSI descending
    const models = await sbFetch('csi_by_model', `run_date=eq.${idx.run_date}&order=csi.desc`);
    models.sort((a, b) => Number(b.csi) - Number(a.csi));
    if (statModels) statModels.textContent = models.length;
    if (modelTable && models.length) {
      modelTable.innerHTML = models.map(m => `
        <tr>
          <td class="model-name">${shortModel(m.model)}</td>
          <td class="num">${fmt(m.avg_score, 3)}</td>
          <td class="num">${fmt(m.avg_latency, 2)}s</td>
          <td class="num">${fmtCost(m.avg_cost)}</td>
          <td class="num">${fmt(m.cs, 4)}</td>
          <td class="num">${fmt(m.cd, 2)}</td>
          <td class="num"><strong>${fmt(m.csi, 2)}</strong></td>
        </tr>`).join('');
      // Populate callout spread
      const callout = document.getElementById('callout-insight');
      const spreadEl = document.getElementById('csi-spread');
      if (callout && spreadEl && models.length >= 2) {
        const csiValues = models.map(m => Number(m.csi));
        const maxCSI = Math.max(...csiValues);
        const minCSI = Math.min(...csiValues);
        if (minCSI > 0) {
          const spread = Math.round(maxCSI / minCSI);
          spreadEl.textContent = spread + 'x';
          callout.style.display = '';
        }
      }
      // Populate efficiency spread line
      const effSpread = document.getElementById('efficiency-spread');
      if (effSpread && models.length >= 2) {
        const csiVals = models.map(m => ({ name: shortModel(m.model), csi: Number(m.csi) }));
        const best = csiVals.reduce((a, b) => a.csi > b.csi ? a : b);
        const worst = csiVals.reduce((a, b) => a.csi < b.csi ? a : b);
        if (worst.csi > 0) {
          const ratio = Math.round(best.csi / worst.csi);
          effSpread.querySelector('span').textContent =
            ratio + '\u00d7 efficiency spread \u2014 ' +
            best.name + ' (' + fmt(best.csi, 0) + ') to ' +
            worst.name + ' (' + fmt(worst.csi, 2) + ')';
          effSpread.style.display = '';
        }
      }
    } else if (modelTable) {
      showFallback(modelTable.closest('.table-wrap') || modelTable, 'No per-model data available.');
    }

    // Check for previous date to show delta
    const prev = await sbFetch('csi_index', 'order=run_date.desc&limit=1&offset=1');
    const deltaBadge = document.getElementById('hero-delta');
    if (deltaBadge && prev.length) {
      const prevCSI = Number(prev[0].csi_aggregate);
      if (prevCSI > 0) {
        const delta = (csiVal - prevCSI) / prevCSI;
        deltaBadge.className = `badge ${delta >= 0 ? 'badge-up' : 'badge-down'}`;
        deltaBadge.textContent = fmtPct(delta) + ' vs prev';
      }
    }
  } catch (err) {
    console.error('Dashboard load error:', err);
    heroNum.textContent = '—';
    heroDate.textContent = 'Error loading data';
  }
}

/* =========================================================================
   CHART: CSI Over Time (index.html)
   ========================================================================= */

async function loadCSIChart() {
  const canvas = document.getElementById('csi-chart');
  if (!canvas || typeof Chart === 'undefined') return;

  try {
    const history = await sbFetch('csi_index', 'select=run_date,csi_aggregate&order=run_date.asc');
    if (!history.length) return;

    const labels = history.map(r => r.run_date);
    const raw = history.map(r => Number(r.csi_aggregate));

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
          borderColor: '#6ee7b7',
          backgroundColor: 'rgba(110,231,183,0.1)',
          fill: true,
          tension: 0.3,
          pointRadius: values.length === 1 ? 6 : 3,
          pointBackgroundColor: '#6ee7b7',
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false },
        },
        scales: {
          x: {
            ticks: { color: '#8494a7' },
            grid: { color: 'rgba(255,255,255,0.05)' },
          },
          y: {
            ticks: { color: '#8494a7' },
            grid: { color: 'rgba(255,255,255,0.05)' },
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
   CHART: CSI Forward Curve (index.html)
   ========================================================================= */

async function loadForwardChart() {
  const canvas = document.getElementById('forward-chart');
  if (!canvas || typeof Chart === 'undefined') return;

  try {
    // Fetch current CSI aggregate (the "Now" point)
    const aggRows = await sbFetch('csi_index', 'select=csi_aggregate&order=run_date.desc&limit=1');
    const currentCSI = aggRows.length ? Number(aggRows[0].csi_aggregate) : null;

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
              color: '#c9d1d9',
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
                    l.fontColor = '#000000';
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
            ticks: { color: '#8494a7', font: { size: 13 } },
            grid: { color: 'rgba(255,255,255,0.05)' },
          },
          y: {
            title: { display: true, text: 'Projected CSI Aggregate', color: '#8494a7', font: { size: 13 } },
            ticks: { color: '#8494a7' },
            grid: { color: 'rgba(255,255,255,0.05)' },
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
  const spreadEl = document.getElementById('research-spread');
  const detailEl = document.getElementById('research-spread-detail');
  if (!spreadEl) return; // not on research page

  try {
    const agg = await sbFetch('csi_index', 'order=run_date.desc&limit=1');
    if (!agg.length) return;

    const models = await sbFetch('csi_by_model', `run_date=eq.${agg[0].run_date}&order=csi.desc`);
    if (models.length < 2) return;

    const csiVals = models.map(m => ({ name: shortModel(m.model), csi: Number(m.csi) }));
    const best = csiVals.reduce((a, b) => a.csi > b.csi ? a : b);
    const worst = csiVals.reduce((a, b) => a.csi < b.csi ? a : b);
    if (worst.csi <= 0) return;

    const spread = Math.round(best.csi / worst.csi);
    spreadEl.textContent = spread + '\u00d7';
    detailEl.textContent =
      best.name + ' CSI: ' + fmt(best.csi, 0) + ' \u00f7 ' +
      worst.name + ' CSI: ' + fmt(worst.csi, 2) + ' = ' + spread + '\u00d7';
  } catch (err) {
    console.error('Research spread load error:', err);
    // fallback: keep static 271×
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
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#8494a7;">No measurements for this date.</td></tr>';
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

  // Load spot data and enable button
  sbFetch('csi_by_model', 'order=run_date.desc,csi.desc').then(data => {
    _spotData = data;
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
      downloadCSV(forward, 'csi_forward_curve_' + new Date().toISOString().slice(0, 10) + '.csv');
    } catch (err) {
      console.error('Forward curve fetch error:', err);
      alert('Forward curve data not available yet.');
    } finally {
      btnForward.disabled = false;
      btnForward.textContent = 'Download Forward Curve (CSV)';
    }
  });
}

/* =========================================================================
   CHART: What Does $1 Buy? (index.html)
   ========================================================================= */

async function loadCostEqualizer() {
  const section = document.getElementById('cost-equalizer');
  if (!section || typeof Chart === 'undefined') return;

  try {
    // Fetch latest pricing snapshot for each model (most recent snapshot_date)
    const rows = await sbFetch('pricing', 'select=model,input_price_per_million,output_price_per_million&order=snapshot_date.desc');
    if (!rows.length) { section.style.display = 'none'; return; }

    // Deduplicate: keep only the first (most recent) row per model
    const seen = {};
    const pricing = [];
    for (const r of rows) {
      if (!seen[r.model]) {
        seen[r.model] = true;
        pricing.push(r);
      }
    }

    const TASKS = [
      { id: 'chart-10k', label: 'Summarize NVIDIA\u2019s 10-K', inputTokens: 80000, outputTokens: 2000 },
      { id: 'chart-dcf', label: 'Build a DCF Model', inputTokens: 1500, outputTokens: 8000 },
    ];

    const gold = '#c9a227';

    for (const task of TASKS) {
      const canvas = document.getElementById(task.id);
      if (!canvas) continue;

      // Calculate tasks per dollar for each model
      const data = pricing.map(p => {
        const inPrice = Number(p.input_price_per_million);
        const outPrice = Number(p.output_price_per_million);
        const costPerTask = (task.inputTokens / 1e6 * inPrice) + (task.outputTokens / 1e6 * outPrice);
        return {
          name: shortModel(p.model),
          tasksPerDollar: costPerTask > 0 ? 1 / costPerTask : 0,
        };
      }).filter(d => d.tasksPerDollar > 0)
        .sort((a, b) => b.tasksPerDollar - a.tasksPerDollar);

      if (!data.length) continue;

      const maxVal = data[0].tasksPerDollar;
      const labels = data.map(d => d.name);
      const values = data.map(d => d.tasksPerDollar);
      const colors = data.map((d, i) => {
        const opacity = 0.3 + 0.7 * (1 - i / Math.max(data.length - 1, 1));
        return `rgba(201, 162, 39, ${opacity.toFixed(2)})`;
      });

      new Chart(canvas, {
        type: 'bar',
        data: {
          labels,
          datasets: [{
            data: values,
            backgroundColor: colors,
            borderColor: gold,
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
                  return Math.round(ctx.parsed.x).toLocaleString() + ' tasks for $1';
                }
              }
            }
          },
          scales: {
            x: {
              type: 'logarithmic',
              title: { display: true, text: 'Tasks per $1 (log scale)', color: '#8494a7', font: { size: 13 } },
              ticks: {
                color: '#8494a7',
                callback: function(val) {
                  if ([1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000].includes(val)) {
                    return val.toLocaleString();
                  }
                  return '';
                }
              },
              grid: { color: 'rgba(255,255,255,0.05)' },
            },
            y: {
              ticks: { color: '#c9d1d9', font: { size: 13 } },
              grid: { display: false },
            }
          },
          layout: { padding: { right: 60 } },
          animation: {
            onComplete: function() {
              const chart = this;
              const ctx = chart.ctx;
              ctx.font = '13px "IBM Plex Mono", monospace';
              ctx.fillStyle = '#c9d1d9';
              ctx.textAlign = 'left';
              ctx.textBaseline = 'middle';
              const meta = chart.getDatasetMeta(0);
              meta.data.forEach(function(bar, i) {
                const val = Math.round(values[i]).toLocaleString();
                ctx.fillText(val, bar.x + 6, bar.y);
              });
            }
          }
        }
      });
    }

    section.style.display = '';
  } catch (err) {
    console.error('Cost equalizer load error:', err);
    section.style.display = 'none';
  }
}

/* =========================================================================
   PAGE: visualize.html
   ========================================================================= */

// Shared tier color function
function csiTierColor(csi) {
  if (csi >= 400) return '#1D9E75';
  if (csi >= 40) return '#378ADD';
  if (csi >= 5) return '#BA7517';
  return '#A32D2D';
}

// Chart instance refs for cleanup on redraw
let _frontierChart = null;
let _viz10kChart = null;
let _vizDcfChart = null;

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
    r: Math.max(Math.sqrt(Number(m.csi)) * 1.8, 5),
    csi: Number(m.csi),
    name: shortModel(m.model),
    latency: Number(m.avg_latency),
    color: csiTierColor(Number(m.csi)),
  }));

  // Build legend
  const legendEl = document.getElementById('frontier-legend');
  if (legendEl) {
    const tiers = [
      { color: '#1D9E75', label: 'CSI 400+' },
      { color: '#378ADD', label: 'CSI 40\u2013400' },
      { color: '#BA7517', label: 'CSI 5\u201340' },
      { color: '#A32D2D', label: 'CSI < 5' },
    ];
    legendEl.innerHTML = tiers.map(t =>
      `<span style="display:inline-flex;align-items:center;gap:0.4rem;font-size:0.82rem;color:#1a1a1a;">` +
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
          title: { display: true, text: 'Cost per task ($, log scale)', color: '#1a1a1a', font: { size: 13 } },
          ticks: {
            color: '#1a1a1a',
            callback: function(val) { return '$' + val; }
          },
          grid: { color: 'rgba(0,0,0,0.06)' },
        },
        y: {
          title: { display: true, text: 'Capability Score', color: '#1a1a1a', font: { size: 13 } },
          ticks: { color: '#1a1a1a' },
          grid: { color: 'rgba(0,0,0,0.06)' },
          min: 0,
          max: 1,
        }
      },
      animation: {
        onComplete: function() {
          const chart = this;
          const ctx = chart.ctx;
          ctx.font = '13px "IBM Plex Mono", monospace';
          ctx.fillStyle = '#1a1a1a';
          ctx.textAlign = 'center';
          const meta = chart.getDatasetMeta(0);
          meta.data.forEach(function(point, i) {
            const d = data[i];
            const yOffset = d.r > 15 ? -(d.r + 8) : (d.r + 12);
            ctx.fillText(d.name, point.x, point.y + yOffset);
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

  container.innerHTML = '';

  const width = container.clientWidth;
  const height = container.clientHeight || 480;

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
    .attr('stroke', '#0d1117')
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

  section.style.display = '';
}

/* --- Section 3: What Does $1 Buy? --- */

function drawDollarCharts(models) {
  const section = document.getElementById('viz-dollar');
  if (!section || typeof Chart === 'undefined' || !_vizPricing) return;

  if (_viz10kChart) { _viz10kChart.destroy(); _viz10kChart = null; }
  if (_vizDcfChart) { _vizDcfChart.destroy(); _vizDcfChart = null; }

  // Build CSI lookup from models
  const csiMap = {};
  for (const m of models) {
    csiMap[m.model] = Number(m.csi);
  }

  const TASKS = [
    { canvasId: 'viz-chart-10k', insightId: 'viz-insight-10k', inputTokens: 80000, outputTokens: 2000, taskName: "summarize NVIDIA\u2019s 10-K" },
    { canvasId: 'viz-chart-dcf', insightId: 'viz-insight-dcf', inputTokens: 1500, outputTokens: 8000, taskName: "build a DCF model" },
  ];

  const charts = [];

  for (const task of TASKS) {
    const canvas = document.getElementById(task.canvasId);
    if (!canvas) continue;

    const data = _vizPricing.map(p => {
      const inPrice = Number(p.input_price_per_million);
      const outPrice = Number(p.output_price_per_million);
      const costPerTask = (task.inputTokens / 1e6 * inPrice) + (task.outputTokens / 1e6 * outPrice);
      return {
        name: shortModel(p.model),
        tasksPerDollar: costPerTask > 0 ? 1 / costPerTask : 0,
        csi: csiMap[p.model] || 0,
      };
    }).filter(d => d.tasksPerDollar > 0)
      .sort((a, b) => b.tasksPerDollar - a.tasksPerDollar);

    if (!data.length) continue;

    // Populate dynamic insight
    const insightEl = document.getElementById(task.insightId);
    if (insightEl && data.length >= 2) {
      const spread = Math.round(data[0].tasksPerDollar / data[data.length - 1].tasksPerDollar);
      insightEl.innerHTML = '<strong>The cheapest model can ' + task.taskName + ' ' + spread + '\u00d7 more times per dollar than the most expensive.</strong>';
      insightEl.style.display = '';
    }

    const labels = data.map(d => d.name);
    const values = data.map(d => d.tasksPerDollar);
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
                return Math.round(ctx.parsed.x).toLocaleString() + ' tasks for $1';
              }
            }
          }
        },
        scales: {
          x: {
            type: 'logarithmic',
            title: { display: true, text: 'Tasks per $1 (log scale)', color: '#1a1a1a', font: { size: 13 } },
            ticks: {
              color: '#1a1a1a',
              callback: function(val) {
                if ([1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000].includes(val)) {
                  return val.toLocaleString();
                }
                return '';
              }
            },
            grid: { color: 'rgba(0,0,0,0.06)' },
          },
          y: {
            ticks: { color: '#1a1a1a', font: { size: 13 } },
            grid: { display: false },
          }
        },
        layout: { padding: { right: 60 } },
        animation: {
          onComplete: function() {
            const ch = this;
            const cx = ch.ctx;
            cx.font = '13px "IBM Plex Mono", monospace';
            cx.fillStyle = '#1a1a1a';
            cx.textAlign = 'left';
            cx.textBaseline = 'middle';
            const meta = ch.getDatasetMeta(0);
            meta.data.forEach(function(bar, i) {
              const val = Math.round(values[i]).toLocaleString();
              cx.fillText(val, bar.x + 6, bar.y);
            });
          }
        }
      }
    });

    charts.push(chart);
  }

  _viz10kChart = charts[0] || null;
  _vizDcfChart = charts[1] || null;

  section.style.display = '';
}

/* =========================================================================
   Boot
   ========================================================================= */

document.addEventListener('DOMContentLoaded', () => {
  loadDashboard();
  loadCSIChart();
  loadForwardChart();
  loadCostEqualizer();
  loadResearchSpread();
  loadDataPage();
  wireDownloadButtons();
  loadVisualizations();
});
