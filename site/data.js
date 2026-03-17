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
    'gpt-4o': 'GPT-4o',
    'gemini-2.0-flash': 'Gemini 2.0 Flash',
    'meta-llama/llama-3.3-70b-instruct': 'Llama 3.3 70B',
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
   Boot
   ========================================================================= */

document.addEventListener('DOMContentLoaded', () => {
  loadDashboard();
  loadCSIChart();
  loadDataPage();
});
