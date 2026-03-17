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
    const values = history.map(r => Number(r.csi_aggregate));

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
              font: { size: 12 },
              filter: function(item) {
                return !item.text.startsWith('_');
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
            ticks: { color: '#8494a7', font: { size: 12 } },
            grid: { color: 'rgba(255,255,255,0.05)' },
          },
          y: {
            title: { display: true, text: 'Projected CSI Aggregate', color: '#8494a7', font: { size: 12 } },
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
   Boot
   ========================================================================= */

document.addEventListener('DOMContentLoaded', () => {
  loadDashboard();
  loadCSIChart();
  loadForwardChart();
  loadDataPage();
  wireDownloadButtons();
});
