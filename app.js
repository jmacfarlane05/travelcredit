const STORAGE_KEY = "flightCredits";

function loadCredits() {
  const data = localStorage.getItem(STORAGE_KEY);
  return data ? JSON.parse(data) : [];
}

function saveCredits(credits) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(credits));
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function daysUntil(dateStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + "T00:00:00");
  return Math.ceil((target - today) / (1000 * 60 * 60 * 24));
}

function formatCurrency(amount) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

function formatDate(dateStr) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function expirationTag(dateStr) {
  const days = daysUntil(dateStr);
  if (days < 0) {
    return `<span class="tag expired">Expired</span>`;
  }
  if (days === 0) {
    return `<span class="tag expired">Expires today</span>`;
  }
  if (days <= 30) {
    return `<span class="tag expiring-soon">Expires in ${days} day${days === 1 ? "" : "s"}</span>`;
  }
  return `<span class="tag">Expires ${formatDate(dateStr)}</span>`;
}

function creditCardClass(dateStr) {
  const days = daysUntil(dateStr);
  if (days < 0) return "credit-card expired";
  if (days <= 30) return "credit-card expiring-soon";
  return "credit-card";
}

function renderCredits() {
  const credits = loadCredits();
  const list = document.getElementById("creditsList");
  const emptyState = document.getElementById("emptyState");

  // Sort: expiring soonest first, expired at the bottom
  credits.sort((a, b) => {
    const aDays = daysUntil(a.expirationDate);
    const bDays = daysUntil(b.expirationDate);
    const aExpired = aDays < 0;
    const bExpired = bDays < 0;
    if (aExpired !== bExpired) return aExpired ? 1 : -1;
    return aDays - bDays;
  });

  // Clear existing cards (keep empty state element)
  list.querySelectorAll(".credit-card").forEach((el) => el.remove());

  if (credits.length === 0) {
    emptyState.style.display = "block";
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
            ${credit.confirmationCode ? `<span class="tag">${escapeHtml(credit.confirmationCode)}</span>` : ""}
            ${credit.notes ? `<span class="tag">${escapeHtml(credit.notes)}</span>` : ""}
          </div>
        </div>
        <div class="credit-amount">${formatCurrency(credit.amount)}</div>
        <div class="credit-actions">
          <button class="btn btn-edit" data-id="${credit.id}">Edit</button>
          <button class="btn btn-danger" data-id="${credit.id}">Delete</button>
        </div>
      `;
      list.appendChild(card);
    });
  }

  updateSummary(credits);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function updateSummary(credits) {
  const activeCredits = credits.filter((c) => daysUntil(c.expirationDate) >= 0);
  const total = activeCredits.reduce((sum, c) => sum + c.amount, 0);
  const expiringSoon = activeCredits
    .filter((c) => daysUntil(c.expirationDate) <= 30)
    .reduce((sum, c) => sum + c.amount, 0);
  const airlines = new Set(activeCredits.map((c) => c.airline.toLowerCase()));

  document.getElementById("totalCredits").textContent = formatCurrency(total);
  document.getElementById("expiringCredits").textContent =
    formatCurrency(expiringSoon);
  document.getElementById("airlineCount").textContent = airlines.size;
}

// Modal handling
const modalOverlay = document.getElementById("modalOverlay");
const creditForm = document.getElementById("creditForm");

function openModal(credit) {
  document.getElementById("modalTitle").textContent = credit
    ? "Edit Flight Credit"
    : "Add Flight Credit";
  document.getElementById("creditId").value = credit ? credit.id : "";
  document.getElementById("airline").value = credit ? credit.airline : "";
  document.getElementById("amount").value = credit ? credit.amount : "";
  document.getElementById("expirationDate").value = credit
    ? credit.expirationDate
    : "";
  document.getElementById("confirmationCode").value = credit
    ? credit.confirmationCode || ""
    : "";
  document.getElementById("notes").value = credit ? credit.notes || "" : "";
  modalOverlay.classList.add("active");
  document.getElementById("airline").focus();
}

function closeModal() {
  modalOverlay.classList.remove("active");
  creditForm.reset();
}

document.getElementById("addCreditBtn").addEventListener("click", () => {
  openModal(null);
});

document.getElementById("cancelBtn").addEventListener("click", closeModal);

modalOverlay.addEventListener("click", (e) => {
  if (e.target === modalOverlay) closeModal();
});

creditForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const credits = loadCredits();
  const id = document.getElementById("creditId").value;
  const creditData = {
    id: id || generateId(),
    airline: document.getElementById("airline").value.trim(),
    amount: parseFloat(document.getElementById("amount").value),
    expirationDate: document.getElementById("expirationDate").value,
    confirmationCode: document
      .getElementById("confirmationCode")
      .value.trim(),
    notes: document.getElementById("notes").value.trim(),
  };

  if (id) {
    const index = credits.findIndex((c) => c.id === id);
    if (index !== -1) credits[index] = creditData;
  } else {
    credits.push(creditData);
  }

  saveCredits(credits);
  closeModal();
  renderCredits();
});

// Delegate edit/delete clicks
document.getElementById("creditsList").addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  const id = btn.dataset.id;
  const credits = loadCredits();

  if (btn.classList.contains("btn-edit")) {
    const credit = credits.find((c) => c.id === id);
    if (credit) openModal(credit);
  } else if (btn.classList.contains("btn-danger")) {
    if (confirm("Delete this credit?")) {
      saveCredits(credits.filter((c) => c.id !== id));
      renderCredits();
    }
  }
});

// Keyboard shortcut: Escape to close modal
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModal();
});

// Initial render
renderCredits();
