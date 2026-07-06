export const adminHtml = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Turso DB Admin Dashboard | 에이아잉 (AI-ing)</title>
<link rel="icon" type="image/png" href="favicon-96x96.png">
<link rel="stylesheet" as="style" crossorigin href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css">
<style>
  :root {
    --bg-dark: #07080d;
    --card-bg: rgba(18, 20, 29, 0.7);
    --card-border: rgba(255, 255, 255, 0.08);
    --accent: #8c82ff;
    --accent-hover: #7669ff;
    --text-main: #f0f3f9;
    --text-sub: #949eb5;
    --success: #10b981;
    --warning: #f59e0b;
    --danger: #ef4444;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: var(--bg-dark);
    color: var(--text-main);
    font-family: "Pretendard", -apple-system, BlinkMacSystemFont, system-ui, Roboto, sans-serif;
    min-height: 100vh;
    padding-bottom: 60px;
  }
  .navbar {
    position: sticky; top: 0; z-index: 100;
    background: rgba(7, 8, 13, 0.85);
    backdrop-filter: blur(16px);
    border-bottom: 1px solid var(--card-border);
    padding: 16px 24px;
    display: flex; justify-content: space-between; align-items: center;
  }
  .brand { display: flex; align-items: center; gap: 12px; font-weight: 700; font-size: 18px; }
  .brand img { width: 32px; height: 32px; border-radius: 6px; }
  .brand span { color: var(--accent); }
  
  .nav-actions { display: flex; align-items: center; gap: 12px; }
  .btn {
    background: rgba(255,255,255,0.06);
    border: 1px solid var(--card-border);
    color: var(--text-main);
    padding: 8px 16px; border-radius: 6px;
    font-size: 13px; font-weight: 600; cursor: pointer;
    transition: all 0.2s;
  }
  .btn:hover { background: rgba(255,255,255,0.12); }
  .btn-primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  .btn-primary:hover { background: var(--accent-hover); }

  .container { max-width: 1280px; margin: 24px auto; padding: 0 24px; }
  
  /* Password Lock Screen */
  .auth-overlay {
    position: fixed; inset: 0; z-index: 999;
    background: rgba(7, 8, 13, 0.95);
    backdrop-filter: blur(20px);
    display: flex; justify-content: center; align-items: center;
  }
  .auth-box {
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: 16px; padding: 36px;
    width: min(420px, 90vw); text-align: center;
    box-shadow: 0 20px 50px rgba(0,0,0,0.5);
  }
  .auth-box h2 { font-size: 22px; margin-bottom: 8px; }
  .auth-box p { font-size: 13.5px; color: var(--text-sub); margin-bottom: 24px; }
  .input-field {
    width: 100%; padding: 12px 16px;
    background: rgba(0,0,0,0.4); border: 1px solid var(--card-border);
    border-radius: 8px; color: #fff; font-size: 15px; margin-bottom: 16px;
    outline: none; transition: border 0.2s;
  }
  .input-field:focus { border-color: var(--accent); }

  /* KPI Grid */
  .kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; margin-bottom: 24px; }
  .kpi-card {
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: 12px; padding: 20px;
  }
  .kpi-title { font-size: 13px; color: var(--text-sub); font-weight: 500; margin-bottom: 8px; }
  .kpi-value { font-size: 28px; font-weight: 700; color: #fff; }
  .kpi-sub { font-size: 12px; color: var(--success); margin-top: 4px; display: flex; align-items: center; gap: 4px; }

  /* Table Navigation Tabs */
  .tabs { display: flex; gap: 8px; margin-bottom: 16px; border-bottom: 1px solid var(--card-border); padding-bottom: 12px; overflow-x: auto; }
  .tab-btn {
    background: none; border: none; color: var(--text-sub);
    padding: 8px 16px; border-radius: 6px; font-size: 14px; font-weight: 600;
    cursor: pointer; transition: all 0.2s; white-space: nowrap;
  }
  .tab-btn.active { background: rgba(140, 130, 255, 0.15); color: var(--accent); }

  /* Data Table */
  .table-card {
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: 12px; overflow: hidden;
  }
  .table-header-bar {
    padding: 16px 20px; display: flex; justify-content: space-between; align-items: center;
    border-bottom: 1px solid var(--card-border);
  }
  .table-title { font-size: 16px; font-weight: 700; }
  .table-search {
    padding: 8px 12px; background: rgba(0,0,0,0.3);
    border: 1px solid var(--card-border); border-radius: 6px;
    color: #fff; font-size: 13px; outline: none; width: 220px;
  }

  .table-wrapper { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; text-align: left; font-size: 13.5px; }
  th { background: rgba(255,255,255,0.03); color: var(--text-sub); padding: 12px 20px; font-weight: 600; border-bottom: 1px solid var(--card-border); white-space: nowrap; }
  td { padding: 14px 20px; border-bottom: 1px solid rgba(255,255,255,0.04); white-space: nowrap; }
  tr:hover td { background: rgba(255,255,255,0.02); }

  /* Badges */
  .badge {
    display: inline-block; padding: 4px 10px; border-radius: 20px;
    font-size: 11.5px; font-weight: 700; text-transform: uppercase;
  }
  .badge-success { background: rgba(16, 185, 129, 0.15); color: var(--success); }
  .badge-warning { background: rgba(245, 158, 11, 0.15); color: var(--warning); }
  .badge-danger { background: rgba(239, 68, 68, 0.15); color: var(--danger); }
  .badge-info { background: rgba(140, 130, 255, 0.15); color: var(--accent); }

  /* Pagination */
  .pagination {
    padding: 16px 20px; display: flex; justify-content: space-between; align-items: center;
    border-top: 1px solid var(--card-border); font-size: 13px; color: var(--text-sub);
  }
</style>
</head>
<!-- Password Authentication Modal (Removed Server-Side Guard bypass) -->
<div id="auth-modal" class="auth-overlay" style="display:none;"></div>

<!-- Header Navbar -->
<nav class="navbar">
  <div class="brand">
    <img src="https://payment.ai-ing.org/logo.png" alt="AI-ing Logo" onerror="this.src='https://ai-ing.org/logo.png'">
    <div>에이아잉 <span>Turso DB Admin</span></div>
  </div>
  <div class="nav-actions">
    <span id="live-indicator" style="font-size: 12px; color: var(--success); display: flex; align-items: center; gap: 6px;">
      <span style="width: 8px; height: 8px; background: var(--success); border-radius: 50%;"></span> Turso DB Live
    </span>
    <button class="btn" onclick="fetchDashboard()">🔄 새로고침</button>
  </div>
</nav>

<div class="container">

  <!-- KPI Overview -->
  <div class="kpi-grid">
    <div class="kpi-card">
      <div class="kpi-title">총 주문 수 (Total Orders)</div>
      <div class="kpi-value" id="kpi-orders">-</div>
      <div class="kpi-sub">📦 Turso DB 실시간 기입</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-title">총 결제 시도 (Payment Attempts)</div>
      <div class="kpi-value" id="kpi-attempts">-</div>
      <div class="kpi-sub">💳 PG/PayPal 트랜잭션 수</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-title">백엔드 작동 모드</div>
      <div class="kpi-value" style="font-size: 20px; color: var(--accent);" id="kpi-mode">PortOne & PayPal</div>
      <div class="kpi-sub" style="color: var(--text-sub);" id="kpi-backend-url">Vercel Backend</div>
    </div>
  </div>

  <!-- Table Tabs -->
  <div class="tabs">
    <button class="tab-btn active" onclick="switchTab('dashboard')">📊 실시간 주문 모니터링</button>
    <button class="tab-btn" onclick="switchTab('Order')">📦 Orders (주문 대장)</button>
    <button class="tab-btn" onclick="switchTab('PaymentAttempt')">💳 Payment Attempts (결제 시도)</button>
    <button class="tab-btn" onclick="switchTab('SettlementRecord')">💰 Settlement Records (정산 기록)</button>
    <button class="tab-btn" onclick="switchTab('LedgerEntry')">📜 Ledger Entries (회계 장부)</button>
    <button class="tab-btn" onclick="switchTab('AuditLog')">🛡️ Audit Logs (감사 로그)</button>
  </div>

  <!-- Main Data Table -->
  <div class="table-card">
    <div class="table-header-bar">
      <div class="table-title" id="current-table-title">최근 주문 및 결제 내역</div>
      <input type="text" class="table-search" id="table-search" placeholder="검색어 입력..." onkeyup="filterTable()">
    </div>
    <div class="table-wrapper">
      <table id="data-table">
        <thead id="table-head">
          <tr>
            <th>ID</th>
            <th>상품명</th>
            <th>금액</th>
            <th>통화</th>
            <th>상태</th>
            <th>생성일시</th>
          </tr>
        </thead>
        <tbody id="table-body">
          <tr><td colspan="6" style="text-align: center; color: var(--text-sub); padding: 40px;">데이터를 불러오는 중입니다...</td></tr>
        </tbody>
      </table>
    </div>
    <div class="pagination">
      <span id="page-info">Page 1 of 1</span>
      <div>
        <button class="btn" id="btn-prev" onclick="changePage(-1)">이전</button>
        <button class="btn" id="btn-next" onclick="changePage(1)">다음</button>
      </div>
    </div>
  </div>

</div>

<script>
  let adminPassword = '';
  const backendBaseUrl = window.location.origin;
  let currentTab = 'dashboard';
  let currentPage = 1;
  let rawData = [];

  function checkAuth() {
    // 서버사이드 게이트웨이 인증을 이미 통과했으므로 모달 생략 및 즉시 쿼리
    document.getElementById('auth-modal').style.display = 'none';
    fetchDashboard();
  }

  function login() {
    fetchDashboard();
  }

  function logout() {
    window.location.href = "/";
  }

  async function fetchDashboard() {
    try {
      const res = await fetch(backendBaseUrl + "/api/v1/admin/dashboard", {
        headers: { 'x-admin-password': adminPassword }
      });
      if (res.status === 401) {
        alert('암호가 올바르지 않습니다.');
        logout();
        return;
      }
      const data = await res.json();
      if (data.ok) {
        document.getElementById('kpi-orders').innerText = data.totals.orders;
        document.getElementById('kpi-attempts').innerText = data.totals.paymentAttempts;
        document.getElementById('kpi-mode').innerText = data.mode || 'Active';
        document.getElementById('kpi-backend-url').innerText = backendBaseUrl;
        
        if (currentTab === 'dashboard') {
          renderDashboardTable(data.orders);
        }
      }
    } catch (e) {
      console.error('Failed to fetch dashboard:', e);
    }
  }

  async function fetchTableData(tableName, page = 1) {
    try {
      const res = await fetch(backendBaseUrl + "/api/v1/admin/tables/" + tableName + "/rows?page=" + page + "&pageSize=20", {
        headers: { 'x-admin-password': adminPassword }
      });
      const data = await res.json();
      if (data.ok) {
        rawData = data.rows;
        renderGenericTable(data.rows, data.page, data.totalPages);
      }
    } catch (e) {
      console.error('Failed to fetch table:', e);
    }
  }

  function renderDashboardTable(orders) {
    document.getElementById('current-table-title').innerText = '최근 주문 및 결제 내역';
    const tbody = document.getElementById('table-body');
    const thead = document.getElementById('table-head');
    
    thead.innerHTML = "<tr><th>Order ID</th><th>상품명</th><th>금액</th><th>통화</th><th>상태</th><th>생성일시</th></tr>";

    if (!orders || orders.length === 0) {
      tbody.innerHTML = "<tr><td colspan='6' style='text-align:center; padding:30px;'>기록된 주문이 없습니다.</td></tr>";
      return;
    }

    tbody.innerHTML = orders.map(o => {
      return "<tr>" +
        "<td style='font-family:monospace; color:var(--accent);'>" + o.id + "</td>" +
        "<td>" + (o.itemName || '기본 주문') + "</td>" +
        "<td style='font-weight:700;'>" + o.amount + "</td>" +
        "<td>" + o.currency + "</td>" +
        "<td><span class='badge " + getStatusBadge(o.status) + "'>" + o.status + "</span></td>" +
        "<td style='color:var(--text-sub);'>" + new Date(o.createdAt).toLocaleString() + "</td>" +
        "</tr>";
    }).join('');
  }

  function renderGenericTable(rows, page, totalPages) {
    const tbody = document.getElementById('table-body');
    const thead = document.getElementById('table-head');
    
    if (!rows || rows.length === 0) {
      tbody.innerHTML = "<tr><td colspan='6' style='text-align:center; padding:30px;'>데이터가 없습니다.</td></tr>";
      return;
    }

    const keys = Object.keys(rows[0]).slice(0, 6);
    thead.innerHTML = "<tr>" + keys.map(k => "<th>" + k + "</th>").join('') + "</tr>";

    tbody.innerHTML = rows.map(r => {
      return "<tr>" +
        keys.map(k => {
          let val = r[k];
          if (typeof val === 'object' && val !== null) val = JSON.stringify(val);
          if (k === 'status') return "<td><span class='badge " + getStatusBadge(val) + "'>" + val + "</span></td>";
          return "<td>" + (val ?? '-') + "</td>";
        }).join('') +
        "</tr>";
    }).join('');

    document.getElementById('page-info').innerText = "Page " + page + " of " + (totalPages || 1);
  }

  function getStatusBadge(status) {
    if (['PAID', 'CAPTURED', 'SETTLED', 'SUCCESS'].includes(status)) return 'badge-success';
    if (['CREATED', 'APPROVAL_READY', 'PAYMENT_PENDING'].includes(status)) return 'badge-info';
    if (['CANCELED', 'REFUNDED'].includes(status)) return 'badge-warning';
    return 'badge-danger';
  }

  function switchTab(tabName) {
    currentTab = tabName;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    event.target.classList.add('active');

    if (tabName === 'dashboard') {
      fetchDashboard();
    } else {
      document.getElementById('current-table-title').innerText = tabName + " 테이블 데이터";
      fetchTableData(tabName, 1);
    }
  }

  function filterTable() {
    const query = document.getElementById('table-search').value.toLowerCase();
    const rows = document.querySelectorAll('#table-body tr');
    rows.forEach(r => {
      const text = r.innerText.toLowerCase();
      r.style.display = text.includes(query) ? '' : 'none';
    });
  }

  checkAuth();
</script>
</body>
</html>`;
