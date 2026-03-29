const connectSection = document.getElementById("connectSection");
const dashboard = document.getElementById("dashboard");
const scanBtn = document.getElementById("scanBtn");
const disconnectBtn = document.getElementById("disconnectBtn");
const scanStatus = document.getElementById("scanStatus");
const creditsList = document.getElementById("creditsList");
const emptyState = document.getElementById("emptyState");

function formatCurrency(amount) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + "T00:00:00");
  return Math.ceil((target - today) / (1000 * 60 * 60 * 24));
}

function formatDate(dateStr) {
  if (!dateStr) return "Unknown";
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function expirationTag(dateStr) {
  if (!dateStr) {
    return '<span class="tag unknown">Expiration unknown</span>';
  }
  const days = daysUntil(dateStr);
  if (days < 0) return '<span class="tag expired">Expired</span>';
  if (days === 0) return '<span class="tag expired">Expires today</span>';
  if (days <= 30) {
    return `<span class="tag expiring-soon">Expires in ${days} day${days === 1 ? "" : "s"}</span>`;
  }
  return `<span class="tag">Expires ${formatDate(dateStr)}</span>`;
}

function creditCardClass(dateStr) {
  if (!dateStr) return "credit-card unknown";
  const days = daysUntil(dateStr);
  if (days < 0) return "credit-card expired";
  if (days <= 30) return "credit-card expiring-soon";
  return "credit-card";
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function renderCredits(credits) {
  credits.sort((a, b) => {
    const aDays = daysUntil(a.expirationDate);
    const bDays = daysUntil(b.expirationDate);
    const aExpired = aDays !== null && aDays < 0;
    const bExpired = bDays !== null && bDays < 0;
    if (aExpired !== bExpired) return aExpired ? 1 : -1;
    if (aDays === null && bDays === null) return 0;
    if (aDays === null) return 1;
    if (bDays === null) return -1;
    return aDays - bDays;
  });

  creditsList.querySelectorAll(".credit-card").forEach((el) => el.remove());

  if (credits.length === 0) {
    emptyState.style.display = "block";
    emptyState.textContent = "No flight credits found in your email.";
  } else {
    emptyState.style.display = "none";
    credits.forEach((credit) => {
      const card = document.createElement("div");
      card.className = creditCardClass(credit.expirationDate);
      card.innerHTML = `
        <div class="credit-details">
          <div class="credit-airline">${escapeHtml(credit.airline)}</div>
          <div class="credit-meta">
            ${expirationTag(credit.expirationDate)}
            ${credit.confirmationCode ? `<span class="tag code">${escapeHtml(credit.confirmationCode)}</span>` : ""}
          </div>
          ${credit.emailSubject ? `<div class="credit-source">From: ${escapeHtml(credit.emailSubject)}</div>` : ""}
        </div>
        <div class="credit-amount">${formatCurrency(credit.amount)}</div>
        <div class="credit-actions">
          <button class="btn btn-danger" data-id="${credit.id}">Dismiss</button>
        </div>
      `;
      creditsList.appendChild(card);
    });
  }

  updateSummary(credits);
}

function updateSummary(credits) {
  const activeCredits = credits.filter((c) => {
    const days = daysUntil(c.expirationDate);
    return days === null || days >= 0;
  });
  const total = activeCredits.reduce((sum, c) => sum + c.amount, 0);
  const expiringSoon = activeCredits
    .filter((c) => {
      const days = daysUntil(c.expirationDate);
      return days !== null && days <= 30;
    })
    .reduce((sum, c) => sum + c.amount, 0);
  const airlines = new Set(activeCredits.map((c) => c.airline));

  document.getElementById("totalCredits").textContent = formatCurrency(total);
  document.getElementById("expiringCredits").textContent = formatCurrency(expiringSoon);
  document.getElementById("airlineCount").textContent = airlines.size;
}

async function checkStatus() {
  const res = await fetch("/api/status");
  const { connected } = await res.json();

  if (connected || new URLSearchParams(location.search).has("connected")) {
    connectSection.style.display = "none";
    dashboard.style.display = "block";

    const creditsRes = await fetch("/api/credits");
    const data = await creditsRes.json();
    if (data.credits.length > 0) {
      renderCredits(data.credits);
    }
  } else {
    connectSection.style.display = "block";
    dashboard.style.display = "none";
  }
}

scanBtn.addEventListener("click", async () => {
  scanBtn.disabled = true;
  scanStatus.textContent = "Scanning your email...";

  try {
    const res = await fetch("/api/scan", { method: "POST" });
    if (res.status === 401) {
      scanStatus.textContent = "Session expired. Reconnecting...";
      window.location.href = "/auth/google";
      return;
    }
    const data = await res.json();
    scanStatus.textContent = `Found ${data.credits.length} credit(s) from ${data.scanned} emails.`;
    renderCredits(data.credits);
  } catch {
    scanStatus.textContent = "Scan failed. Please try again.";
  } finally {
    scanBtn.disabled = false;
  }
});

disconnectBtn.addEventListener("click", async () => {
  if (!confirm("Disconnect Gmail? This will clear all found credits.")) return;
  await fetch("/api/disconnect", { method: "POST" });
  connectSection.style.display = "block";
  dashboard.style.display = "none";
  history.replaceState(null, "", "/");
});

creditsList.addEventListener("click", async (e) => {
  const btn = e.target.closest(".btn-danger");
  if (!btn) return;
  const id = btn.dataset.id;
  const res = await fetch(`/api/credits/${id}`, { method: "DELETE" });
  const data = await res.json();
  renderCredits(data.credits);
});

checkStatus();
