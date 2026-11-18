(() => {
  "use strict";

  const STORE_KEY = "roomsync-demo-v1";
  const TOKEN_KEY = "roomsync-auth-token";
  const SCHEMA_VERSION = 2;
  const COLORS = ["#6e64d8", "#18a999", "#f47e68", "#e9ad45", "#5087d9", "#bd6bb5", "#5eaf72", "#d48750", "#67849d", "#8a75bc"];
  const configuredApiBase = document.querySelector('meta[name="roomsync-api-base"]')?.content.trim().replace(/\/+$/, "");
  const localFrontend = window.location.protocol === "file:" || ["localhost", "127.0.0.1"].includes(window.location.hostname);
  const API_BASE_URL = configuredApiBase || (localFrontend
    ? `${window.location.protocol === "https:" ? "https:" : "http:"}//${window.location.hostname || "localhost"}:${window.ROOMSYNC_API_PORT || 3000}/api`
    : "/api");
  const initialData = () => ({
    schemaVersion: SCHEMA_VERSION,
    roomName: "",
    roomCity: "",
    profile: { name: "", email: "" },
    roommates: [],
    rent: 0,
    rentDueDate: "",
    rentSplit: {},
    expenses: [],
    payments: [],
    paymentStatuses: {},
    shopping: [],
    inventory: [],
    locations: [],
    notices: [],
    shoppingList: [],
    reminders: [],
    calendarEvents: [],
    theme: "light"
  });
  let data = initialData();
  let authUser = null;
  let syncTimer = 0;
  let syncing = false;
  let syncAgain = false;
  const pageContent = document.getElementById("pageContent");
  const money = (value) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number(value) || 0);
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const roommateNames = () => {
    const names = new Map();
    data.roommates.forEach((roommate) => {
      const name = typeof roommate.name === "string" ? roommate.name.trim() : "";
      if (name && !names.has(name.toLowerCase())) names.set(name.toLowerCase(), name);
    });
    return [...names.values()];
  };
  const shortDate = (value) => value ? new Date(`${value}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "—";
  const id = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const getDateKey = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const getMonthKey = (date = new Date()) => getDateKey(date).slice(0, 7);
  let currentPage = "dashboard";
  let charts = [];
  let expenseFilter = "all";
  let reportMonth = getMonthKey();
  let selectedHistoryRoommate = "";

  async function apiRequest(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) headers.Authorization = `Bearer ${token}`;
    if (options.body && !(options.body instanceof FormData)) headers["Content-Type"] = "application/json";
    let response;
    try {
      response = await fetch(`${API_BASE_URL}${path}`, {
        ...options,
        headers,
        body: options.body && !(options.body instanceof FormData) ? JSON.stringify(options.body) : options.body
      });
    } catch (error) {
      if (error instanceof TypeError) {
        throw new Error(`Could not connect to the RoomSync API at ${API_BASE_URL}. Start the backend and check its URL.`);
      }
      throw error;
    }
    if (response.status === 204) return null;
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `Request failed (${response.status}).`);
    return result;
  }
  async function synchronizeWorkspace() {
    if (!authUser) return;
    if (syncing) { syncAgain = true; return; }
    syncing = true;
    try {
      await apiRequest("/workspace", { method: "PUT", body: data });
    } catch (error) {
      console.error("RoomSync could not sync workspace:", error);
      toast(`Could not save to the server: ${error.message}`, "danger");
    } finally {
      syncing = false;
      if (syncAgain) {
        syncAgain = false;
        synchronizeWorkspace();
      }
    }
  }
  function persist() {
    try {
      if (authUser) localStorage.setItem(`roomsync-user-${authUser.id}`, JSON.stringify(data));
    } catch (error) {
      console.error("RoomSync could not cache this account's workspace:", error);
      toast("The local cache is unavailable. Changes will still be sent to the server.", "warning");
    }
    if (authUser) {
      window.clearTimeout(syncTimer);
      syncTimer = window.setTimeout(synchronizeWorkspace, 250);
    }
  }
  function toast(message, type = "success") {
    const el = document.createElement("div");
    el.className = `toast align-items-center text-bg-${type} border-0 show`;
    el.setAttribute("role", "status");
    el.innerHTML = `<div class="d-flex"><div class="toast-body">${escapeHtml(message)}</div><button type="button" class="btn-close btn-close-white me-2 m-auto" aria-label="Close"></button></div>`;
    document.getElementById("toastContainer").append(el);
    el.querySelector("button").addEventListener("click", () => el.remove());
    window.setTimeout(() => el.remove(), 3500);
  }
  function heading(title, description, actions = "") {
    return `<div class="page-heading"><div><div class="eyebrow">${escapeHtml(data.roomName || "ROOMSYNC")} · ROOMMATE HUB</div><h1>${title}</h1><p>${description}</p></div><div class="heading-actions">${actions}</div></div>`;
  }
  function panel(title, subtitle, content, action = "") {
    return `<section class="panel"><div class="panel-header"><div><h2 class="panel-title">${title}</h2>${subtitle ? `<div class="panel-subtitle">${subtitle}</div>` : ""}</div>${action}</div>${content}</section>`;
  }
  function empty(icon, text) { return `<div class="empty-state"><i class="bi ${icon}"></i>${text}</div>`; }
  function avatar(person, size = "") {
    const roommate = data.roommates.find((r) => r.name === person);
    const color = roommate?.color || COLORS[0];
    if (roommate?.photo) return `<img class="person-avatar ${size} avatar-photo" src="${roommate.photo}" alt="${escapeHtml(person)}">`;
    const initials = String(person || "?").split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase();
    return `<span class="person-avatar ${size}" style="background:${color}">${escapeHtml(initials)}</span>`;
  }
  function balanceMap() {
    const balances = Object.fromEntries(data.roommates.map((person) => [person.name, 0]));
    for (const expense of data.expenses) {
      if (balances[expense.paidBy] !== undefined) balances[expense.paidBy] += Number(expense.amount);
      if (expense.shares) {
        Object.entries(expense.shares).forEach(([name, amount]) => { if (balances[name] !== undefined) balances[name] -= Number(amount); });
      } else {
        const participants = expense.splitWith?.length ? expense.splitWith : data.roommates.map((r) => r.name);
        const share = Number(expense.amount) / participants.length;
        participants.forEach((name) => { if (balances[name] !== undefined) balances[name] -= share; });
      }
    }
    for (const payment of data.payments) {
      if (balances[payment.person] !== undefined) balances[payment.person] += Number(payment.amount);
      if (payment.recipient && balances[payment.recipient] !== undefined) balances[payment.recipient] -= Number(payment.amount);
    }
    return balances;
  }
  function statusFor(person, due) {
    const balance = balanceMap()[person] || 0;
    if (balance >= 0) return { text: "Paid", cls: "paid" };
    if (balance > -Number(due)) return { text: "Partial", cls: "partial" };
    return { text: "Unpaid", cls: "pending" };
  }
  function destroyCharts() { charts.forEach((chart) => chart.destroy()); charts = []; }
  function chartDefaults() {
    const dark = document.body.classList.contains("dark-mode");
    return { color: dark ? "#9ba6b7" : "#8995a6", grid: dark ? "#30394a" : "#edf0f5" };
  }
  function createCharts() {
    destroyCharts();
    if (!window.Chart) return;
    const defaults = chartDefaults();
    Chart.defaults.color = defaults.color;
    Chart.defaults.font.family = "DM Sans";
    Chart.defaults.font.size = 10;
    const spendCanvas = document.getElementById("spendChart");
    if (spendCanvas) {
      const month = new Date();
      const labels = Array.from({ length: 6 }, (_, index) => {
        const d = new Date(month.getFullYear(), month.getMonth() - 5 + index, 1);
        return d.toLocaleDateString("en-IN", { month: "short" });
      });
      const monthly = labels.map((_, index) => {
        const target = new Date(month.getFullYear(), month.getMonth() - 5 + index, 1);
        return data.expenses.filter((e) => {
          const date = new Date(`${e.date}T00:00:00`);
          return date.getMonth() === target.getMonth() && date.getFullYear() === target.getFullYear();
        }).reduce((sum, e) => sum + Number(e.amount), 0);
      });
      charts.push(new Chart(spendCanvas, {
        type: "bar",
        data: { labels, datasets: [{ label: "Room spending", data: monthly, backgroundColor: ["#e6e4ff", "#dcd9ff", "#d0ccff", "#c6c1ff", "#aaa4f7", "#675dd8"], borderRadius: 6, maxBarThickness: 28 }] },
        options: { maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => ` ${money(ctx.raw)}` } } }, scales: { x: { grid: { display: false }, border: { display: false } }, y: { beginAtZero: true, grid: { color: defaults.grid }, border: { display: false }, ticks: { callback: (v) => v >= 1000 ? `${v / 1000}k` : v } } } }
      }));
    }
    const categoryCanvas = document.getElementById("categoryChart");
    if (categoryCanvas) {
      const sums = {};
      data.expenses.forEach((e) => { sums[e.category] = (sums[e.category] || 0) + Number(e.amount); });
      const labels = Object.keys(sums);
      charts.push(new Chart(categoryCanvas, {
        type: "doughnut",
        data: { labels, datasets: [{ data: labels.map((label) => sums[label]), backgroundColor: ["#6e64d8", "#18a999", "#f47e68", "#e9ad45", "#5087d9", "#bd6bb5"], borderWidth: 0, hoverOffset: 4 }] },
        options: { maintainAspectRatio: false, cutout: "70%", plugins: { legend: { position: "bottom", labels: { usePointStyle: true, pointStyle: "circle", padding: 14, boxWidth: 7, font: { size: 9 } } }, tooltip: { callbacks: { label: (ctx) => ` ${ctx.label}: ${money(ctx.raw)}` } } } }
      }));
    }
    const reportCanvas = document.getElementById("reportChart");
    if (reportCanvas) {
      const sums = {};
      selectedReportExpenses().forEach((e) => { sums[e.category] = (sums[e.category] || 0) + Number(e.amount); });
      charts.push(new Chart(reportCanvas, {
        type: "bar",
        data: { labels: Object.keys(sums), datasets: [{ label: "Total spent", data: Object.values(sums), backgroundColor: ["#6e64d8", "#18a999", "#f47e68", "#e9ad45", "#5087d9", "#bd6bb5"], borderRadius: 6, maxBarThickness: 42 }] },
        options: { maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => ` ${money(ctx.raw)}` } } }, scales: { x: { grid: { display: false }, border: { display: false } }, y: { beginAtZero: true, grid: { color: defaults.grid }, border: { display: false }, ticks: { callback: (v) => v >= 1000 ? `${v / 1000}k` : v } } } }
      }));
    }
  }

  function renderDashboard() {
    const monthStart = `${getMonthKey()}-01`;
    const monthlyExpenses = data.expenses.filter((e) => e.date >= monthStart);
    const total = monthlyExpenses.reduce((sum, e) => sum + Number(e.amount), 0);
    const pending = Object.values(balanceMap()).reduce((sum, b) => sum + Math.max(0, -b), 0);
    const currentMonth = new Date().toLocaleDateString("en-IN", { month: "long", year: "numeric" });
    const stat = (title, value, detail, icon, color) => `<div class="stat-card"><div class="stat-top"><span>${title}</span><span class="stat-icon ${color}"><i class="bi ${icon}"></i></span></div><div class="stat-value">${value}</div><div class="stat-foot">${detail}</div></div>`;
    const expenses = [...data.expenses].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 4);
    const activity = expenses.length ? expenses.map((e) => {
      const icon = ({ Food: ["bi-basket2", "food"], Rent: ["bi-house", "rent"], EB: ["bi-lightning", "utilities"], "Wi-Fi": ["bi-wifi", "utilities"], Water: ["bi-droplet", "utilities"] })[e.category] || ["bi-receipt", "shopping"];
      return `<div class="activity-row"><span class="activity-icon ${icon[1]}"><i class="bi ${icon[0]}"></i></span><span class="activity-info"><strong>${escapeHtml(e.title)}</strong><small>${escapeHtml(e.paidBy)} · ${shortDate(e.date)}</small></span><span class="activity-amount">${money(e.amount)}</span></div>`;
    }).join("") : empty("bi-receipt", "No expenses added yet.");
    const balances = balanceMap();
    const members = data.roommates.map((r) => `<div class="roommate-mini">${avatar(r.name)}<span class="person-info"><strong>${escapeHtml(r.name)}</strong><small>${escapeHtml(r.role)}</small></span><span class="balance-pill ${balances[r.name] > 1 ? "positive" : balances[r.name] < -1 ? "negative" : "neutral"}">${balances[r.name] >= 0 ? "+" : "−"}${money(Math.abs(balances[r.name]))}</span></div>`).join("");
    const emptyCharts = !data.expenses.length;
    const welcome = data.roomName ? `Good ${greeting()}${data.profile.name ? `, ${escapeHtml(data.profile.name.split(" ")[0])}` : ""} 👋` : "Welcome to RoomSync";
    const description = data.roomName ? `Here’s your room overview for ${currentMonth}.` : "No room created yet. Create a room, then add your roommates and shared expenses.";
    const actions = data.roomName
      ? `<button class="btn btn-outline-secondary" data-action="download-report"><i class="bi bi-download me-1"></i> Export</button><button class="btn btn-primary" data-action="open-add-expense"><i class="bi bi-plus-lg me-1"></i> Add expense</button>`
      : `<button class="btn btn-primary" data-page="room"><i class="bi bi-house-add me-1"></i> Create your room</button>`;
    pageContent.innerHTML = `${heading(welcome, description, actions)}
      <div class="stat-grid">${stat("Total spending", money(total), `${monthlyExpenses.length} expenses this month`, "bi-wallet2", "purple")}${stat("Monthly room rent", money(data.rent), data.rentDueDate ? `Due ${shortDate(data.rentDueDate)}` : "Rent not set", "bi-house", "teal")}${stat("Pending balance", money(pending), `${Object.values(balances).filter((b) => b < -1).length} roommate${Object.values(balances).filter((b) => b < -1).length === 1 ? "" : "s"} owing`, "bi-hourglass-split", "coral")}${stat("Roommates count", data.roommates.length, "Room members added", "bi-people", "amber")}${stat("Total expenses", data.expenses.length, "Expense records", "bi-receipt", "purple")}</div>
      <div class="dashboard-grid">${panel("Room spending", "A quick look at the last six months", emptyCharts ? empty("bi-bar-chart", "Your spending chart will appear after you add expenses.") : `<div class="chart-wrap"><canvas id="spendChart" aria-label="Room spending chart"></canvas></div>`, `<button class="panel-link" data-page="reports">View report <i class="bi bi-arrow-right"></i></button>`)}${panel("Spending by category", "Where your room budget goes", emptyCharts ? empty("bi-pie-chart", "Category breakdown will appear after you add expenses.") : `<div class="chart-wrap mini-chart-wrap"><canvas id="categoryChart" aria-label="Spending by category chart"></canvas></div>`)}</div>
      <div class="dashboard-lower">${panel("Recent activity", "Latest shared expenses", `<div class="activity-list">${activity}</div>`, `<button class="panel-link" data-page="expenses">See all <i class="bi bi-arrow-right"></i></button>`)}${panel("Roommate balances", "Your room’s running balance", `<div>${members || empty("bi-people", "No roommates added yet.")}</div>`, `<button class="panel-link" data-page="payments">View payments <i class="bi bi-arrow-right"></i></button>`)}</div>`;
    createCharts();
  }
  function greeting() { const hour = new Date().getHours(); return hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening"; }
  function renderRoom() {
    if (!data.roomName) {
      pageContent.innerHTML = `${heading("My room", "Start by creating your own room. No room details or members are added until you enter them.", "")}
        <div class="module-grid"><section class="module-card"><h2>Create a room</h2><p class="module-description">Choose a name and optionally add a location.</p><form id="createRoomForm"><div class="mb-3"><label class="form-label" for="createRoomName">Room name</label><input id="createRoomName" name="roomName" class="form-control" required placeholder="Enter your room name"></div><div class="mb-3"><label class="form-label" for="createRoomCity">City / area (optional)</label><input id="createRoomCity" name="roomCity" class="form-control" placeholder="Enter your location"></div><button class="btn btn-primary" type="submit"><i class="bi bi-house-add me-1"></i> Create room</button></form></section><section class="module-card">${empty("bi-people", "No roommates added yet. Create your room to get started.")}</section></div>`;
      return;
    }
    const rows = data.roommates.map((r) => `<tr><td><span class="d-flex align-items-center gap-2">${avatar(r.name)}${escapeHtml(r.name)}</span></td><td>${escapeHtml(r.role)}</td><td><div class="table-actions"><label class="tiny-icon-button mb-0" title="Upload profile photo"><i class="bi bi-camera"></i><input type="file" class="roommate-photo-input" data-id="${r.id}" accept="image/*" hidden></label><button class="tiny-icon-button" data-action="edit-roommate" data-id="${r.id}" title="Edit roommate"><i class="bi bi-pencil"></i></button><button class="tiny-icon-button" data-action="delete-roommate" data-id="${r.id}" title="Remove roommate"><i class="bi bi-trash3"></i></button><button class="tiny-icon-button" data-page="history" data-roommate="${escapeHtml(r.name)}" title="View expense history"><i class="bi bi-clock-history"></i></button></div></td></tr>`).join("");
    pageContent.innerHTML = `${heading("My room", "Manage your room details and the roommates you add.", `<button class="btn btn-primary" data-action="show-form" data-form="roommateForm"><i class="bi bi-person-plus me-1"></i> Add roommate</button>`)}
      <div class="module-grid"><section class="module-card span-2"><div class="section-heading"><div><h2>Roommates <span class="muted-copy">(${data.roommates.length}/10)</span></h2><div class="module-description mb-0">Only the members you add appear here.</div></div><span class="status available">Room created</span></div><div class="table-wrap"><table class="table"><thead><tr><th>Roommate</th><th>Role</th><th>Actions</th></tr></thead><tbody>${rows || `<tr><td colspan="3">${empty("bi-people", "No roommates added yet.")}</td></tr>`}</tbody></table></div></section>
      <section class="module-card"><h2>Room details</h2><p class="module-description">Edit your room name or location.</p><form id="roomDetailsForm"><div class="mb-3"><label class="form-label" for="roomName">Room name</label><input id="roomName" name="roomName" class="form-control" value="${escapeHtml(data.roomName)}" required></div><div class="mb-3"><label class="form-label" for="roomCity">City / area</label><input id="roomCity" name="roomCity" class="form-control" value="${escapeHtml(data.roomCity)}"></div><button class="btn btn-primary" type="submit">Save room details</button></form></section>
      <section class="module-card" id="roommateForm"><h2>Add a roommate</h2><p class="module-description">Add up to 10 members. Names and photos are entered by you.</p><form id="addRoommateForm"><div class="mb-3"><label class="form-label" for="roommateName">Full name</label><input class="form-control" id="roommateName" name="name" required placeholder="Enter roommate name"></div><div class="mb-3"><label class="form-label" for="roommateRole">Role</label><select class="form-select" id="roommateRole" name="role"><option>Roommate</option><option>Room admin</option></select></div><button class="btn btn-primary" type="submit" ${data.roommates.length >= 10 ? "disabled" : ""}>Add to room</button></form></section></div>`;
  }
  function renderRent() {
    const share = Number(data.rent) / Math.max(data.roommates.length, 1);
    const customSplit = data.roommates.length && Object.keys(data.rentSplit || {}).length === data.roommates.length;
    const rows = data.roommates.map((r) => {
      const percent = customSplit ? Number(data.rentSplit[r.id]) || 0 : 100 / Math.max(data.roommates.length, 1);
      return `<tr><td>${avatar(r.name)} <span class="ms-2">${escapeHtml(r.name)}</span></td><td>${money(data.rent)}</td><td>${customSplit ? `${percent}%` : `${data.roommates.length} equal shares`}</td><td><strong>${money(data.rent * percent / 100)}</strong></td></tr>`;
    }).join("");
    pageContent.innerHTML = `${heading("Rent calculator", "Split your monthly rent fairly. Equal split is ready; custom shares are yours to set.", `<button class="btn btn-outline-secondary" data-action="reset-rent"><i class="bi bi-arrow-counterclockwise me-1"></i> Reset equal split</button>`)}
      <div class="module-grid"><section class="module-card"><h2>Monthly rent</h2><p class="module-description">Enter the actual rent and payment date for your room.</p><form id="rentForm"><div class="mb-3"><label class="form-label" for="rentAmount">Total monthly rent (₹)</label><input class="form-control" type="number" min="0" step="0.01" id="rentAmount" name="rent" value="${Number(data.rent)}" required></div><div class="mb-3"><label class="form-label" for="rentDueDate">Rent payment date</label><input class="form-control" type="date" id="rentDueDate" name="rentDueDate" value="${escapeHtml(data.rentDueDate || "")}"></div><button class="btn btn-primary" type="submit">Save rent details</button></form><hr class="my-4"><div class="stat-top"><span>${customSplit ? "Total monthly rent" : "Each person's equal share"}</span><span class="stat-icon purple"><i class="bi bi-people"></i></span></div><div class="stat-value">${money(customSplit ? data.rent : share)}</div><div class="stat-foot">${customSplit ? "Individual amounts shown in the breakdown" : `Across ${data.roommates.length} roommates`}</div></section>
      <section class="module-card"><h2>Unequal split</h2><p class="module-description">Set custom percentages by roommate. All shares must add up to 100%.</p>${data.roommates.length ? `<form id="unequalRentForm"><div>${data.roommates.map((r, index) => {
        const defaultPercent = Math.floor(100 / data.roommates.length) + (index === data.roommates.length - 1 ? 100 - Math.floor(100 / data.roommates.length) * data.roommates.length : 0);
        return `<div class="split-row"><label>${escapeHtml(r.name)}</label><div class="input-group input-group-sm"><input class="form-control rent-percent" type="number" min="0" max="100" step="0.01" name="${escapeHtml(r.id)}" value="${data.rentSplit?.[r.id] ?? defaultPercent}" aria-label="${escapeHtml(r.name)} percent"><span class="input-group-text">%</span></div></div>`;
      }).join("")}</div><div class="stat-foot mt-2">Total: <strong id="percentTotal">0%</strong></div><div id="unequalResults" class="mt-3"></div><div class="form-actions"><button class="btn btn-primary" type="submit">Apply custom split</button></div></form>` : empty("bi-people", "No roommates added yet.")}</section>
      <section class="module-card span-2"><h2>${customSplit ? "Rent breakdown · custom split" : "Rent breakdown · equal split"}</h2><p class="module-description">Calculated from the room rent and the roommates you have added.</p><div class="table-wrap"><table class="table"><thead><tr><th>Roommate</th><th>Total rent</th><th>Split</th><th>Share due</th></tr></thead><tbody>${rows || `<tr><td colspan="4">${empty("bi-people", "No roommates added yet.")}</td></tr>`}</tbody></table></div></section></div>`;
    updateUnequalTotal();
  }
  function renderExpenses() {
    const shown = [...data.expenses].filter((e) => expenseFilter === "all" || e.category === expenseFilter).sort((a, b) => b.date.localeCompare(a.date));
    const categories = ["all", "EB", "Water", "Wi-Fi", "Food", "Groceries", "Milk", "Gas", "Maintenance", "Rent", "Other"];
    const filters = categories.map((c) => `<button class="btn ${expenseFilter === c ? "btn-soft" : "btn-outline-secondary"}" data-action="filter-expenses" data-filter="${c}">${c === "all" ? "All expenses" : c}</button>`).join("");
    const rows = shown.map((e) => `<tr><td>${escapeHtml(e.title)}${e.note ? `<small class="d-block text-secondary">${escapeHtml(e.note)}</small>` : ""}</td><td><span class="status ${e.category === "Rent" ? "partial" : "available"}">${escapeHtml(e.category)}</span></td><td>${shortDate(e.date)}</td><td>${escapeHtml(e.paidBy)}</td><td>${money(e.amount)}</td><td><div class="table-actions">${e.images?.length ? `<button class="tiny-icon-button" data-action="view-images" data-id="${e.id}" title="View images"><i class="bi bi-image"></i></button>` : ""}<button class="tiny-icon-button" data-action="delete-expense" data-id="${e.id}" title="Delete expense"><i class="bi bi-trash3"></i></button></div></td></tr>`).join("");
    pageContent.innerHTML = `${heading("Expense tracker", "One clear view of rent, utilities, food and everything in between.", `<button class="btn btn-primary" data-action="open-add-expense"><i class="bi bi-plus-lg me-1"></i> Add expense</button>`)}
      <div class="module-grid"><section class="module-card span-2"><div class="section-heading"><div><h2>Shared expenses</h2><div class="module-description mb-0">${data.expenses.length} recorded · split among the roommates selected for each expense</div></div></div><div class="d-flex flex-wrap gap-2 mb-3">${filters}</div><div class="table-wrap"><table class="table"><thead><tr><th>Expense</th><th>Category</th><th>Date</th><th>Paid by</th><th>Amount</th><th>Actions</th></tr></thead><tbody>${rows || `<tr><td colspan="6">${empty("bi-receipt", "No expenses added yet.")}</td></tr>`}</tbody></table></div></section>
      <section class="module-card span-2" id="expenseFormCard"><h2>Add an expense</h2><p class="module-description">Split evenly by default, or select who shares this expense.</p>${expenseForm()}</section></div>`;
    updateExpenseSplitUi();
  }
  function expenseForm() {
    const categories = ["EB", "Water", "Wi-Fi", "Food", "Groceries", "Milk", "Gas", "Maintenance", "Rent", "Other"];
    return `<form id="expenseForm">    <div class="form-grid"><div><label class="form-label" for="expenseTitle">Expense name</label><input class="form-control" id="expenseTitle" name="title" required></div><div><label class="form-label" for="expenseAmount">Amount (₹)</label><input class="form-control" id="expenseAmount" name="amount" type="number" min="0.01" step="0.01" required></div><div><label class="form-label" for="expenseCategory">Category</label><select class="form-select" id="expenseCategory" name="category">${categories.map((category) => `<option>${category}</option>`).join("")}</select></div><div><label class="form-label" for="expenseDate">Date</label><input class="form-control" id="expenseDate" name="date" type="date" required></div><div><label class="form-label" for="expensePayer">Paid by</label><select class="form-select" id="expensePayer" name="paidBy" required>${roommateNames().map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("")}</select></div><div><label class="form-label" for="expenseImages">Bill image</label><input class="form-control" id="expenseImages" name="images" type="file" accept="image/*" multiple><div class="image-preview" id="expenseImagePreview"></div></div><div class="full"><label class="form-label">Split with</label><div class="checkbox-list">${data.roommates.map((r) => `<label class="checkbox-item"><input type="checkbox" name="splitWith" value="${escapeHtml(r.name)}" checked> ${escapeHtml(r.name)}</label>`).join("") || empty("bi-people", "No roommates added yet.")}</div></div><div><label class="form-label" for="expenseSplitMode">Split method</label><select class="form-select" id="expenseSplitMode" name="splitMode"><option value="equal">Split equally</option><option value="custom">Custom percentages</option></select></div><div class="full custom-expense-split" hidden><label class="form-label">Custom shares <span class="text-secondary">· percentages must total 100%</span></label><div class="checkbox-list custom-expense-shares"></div><div class="stat-foot mt-2">Total: <strong class="expense-percent-total">0%</strong></div></div><div class="full"><label class="form-label" for="expenseNote">Notes (optional)</label><input class="form-control" id="expenseNote" name="note"></div></div><div class="form-actions"><button class="btn btn-primary" type="submit">Save expense</button></div></form>`;
  }
  function renderShopping() {
    const rows = [...data.shopping].sort((a, b) => b.date.localeCompare(a.date)).map((s) => `<tr><td>${escapeHtml(s.item)}<div class="image-preview">${s.itemPhoto ? `<img src="${s.itemPhoto}" alt="Item photo" loading="lazy">` : ""}${(s.billImages || s.images || []).map((img) => `<img src="${img}" alt="Shopping bill" loading="lazy">`).join("")}</div></td><td>${money(s.amount)}</td><td>${shortDate(s.date)}</td><td>${s.shopLocation ? `<a href="${safeUrl(s.shopLocation)}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.shop || "Shop")} <i class="bi bi-box-arrow-up-right"></i></a>` : escapeHtml(s.shop || "—")}</td><td>${escapeHtml(s.purchaser || "—")}</td><td><button class="tiny-icon-button" data-action="delete-shopping" data-id="${s.id}" title="Delete purchase"><i class="bi bi-trash3"></i></button></td></tr>`).join("");
    pageContent.innerHTML = `${heading("Shopping tracker", "Keep track of shared purchases, where they came from and who picked them up.", `<button class="btn btn-soft" data-page="list"><i class="bi bi-list-check me-1"></i> Open shopping list</button>`)}
      <div class="module-grid"><section class="module-card"><h2>Add a purchase</h2><p class="module-description">Enter purchase details and attach item or bill photos.</p><form id="shoppingForm"><div class="mb-3"><label class="form-label" for="shopItem">Purchased item</label><input id="shopItem" class="form-control" name="item" required></div><div class="form-grid"><div><label class="form-label" for="shopAmount">Item price (₹)</label><input id="shopAmount" class="form-control" name="amount" type="number" min="0" step="0.01" required></div><div><label class="form-label" for="shopDate">Purchase date</label><input id="shopDate" class="form-control" name="date" type="date" required></div><div><label class="form-label" for="shopName">Shop name</label><input id="shopName" class="form-control" name="shop"></div><div><label class="form-label" for="shopPurchaser">Purchased by</label><select id="shopPurchaser" class="form-select" name="purchaser" required>${data.roommates.map((r) => `<option>${escapeHtml(r.name)}</option>`).join("")}</select></div><div class="full"><label class="form-label" for="shopLocation">Shop location link (optional)</label><input id="shopLocation" class="form-control" name="shopLocation" type="url" placeholder="Google Maps link"></div><div><label class="form-label" for="itemPhoto">Item photo</label><input id="itemPhoto" class="form-control" name="itemPhoto" type="file" accept="image/*"><div id="itemPhotoPreview" class="image-preview"></div></div><div><label class="form-label" for="billImages">Shopping bill photos</label><input id="billImages" class="form-control" name="billImages" type="file" accept="image/*" multiple><div id="billImagesPreview" class="image-preview"></div></div></div><div class="form-actions"><button type="submit" class="btn btn-primary">Save purchase</button></div></form></section>
      <section class="module-card"><h2>Monthly shopping</h2><p class="module-description">Recorded purchases this month.</p><div class="stat-value">${money(monthlyTotal(data.shopping))}</div><div class="stat-foot">${data.shopping.length} purchase${data.shopping.length === 1 ? "" : "s"} recorded</div><hr class="my-4"><h2 class="mb-3">Quick note</h2><p class="module-description mb-0">Remember to upload receipts with each purchase so everyone can see where shared money goes.</p></section>
      <section class="module-card span-2"><h2>Purchase history</h2><p class="module-description">Your room's shared shopping ledger.</p><div class="table-wrap"><table class="table"><thead><tr><th>Item / photos</th><th>Amount</th><th>Date</th><th>Shop / location</th><th>Purchaser</th><th>Action</th></tr></thead><tbody>${rows || `<tr><td colspan="6">${empty("bi-basket2", "No purchases added yet.")}</td></tr>`}</tbody></table></div></section></div>`;
  }
  function monthlyTotal(items) {
    const month = new Date();
    return items.filter((item) => { const date = new Date(`${item.date}T00:00:00`); return date.getMonth() === month.getMonth() && date.getFullYear() === month.getFullYear(); }).reduce((sum, item) => sum + Number(item.amount), 0);
  }
  function renderPayments() {
    const balances = balanceMap();
    const perPerson = data.roommates.map((r) => {
      const balance = balances[r.name] || 0;
      const sharePercent = Number(data.rentSplit?.[r.id] ?? (100 / Math.max(data.roommates.length, 1)));
      const share = Number(data.rent) * sharePercent / 100;
      const hasHistory = data.expenses.some((expense) => expense.paidBy === r.name || expense.splitWith?.includes(r.name)) || data.payments.some((payment) => payment.person === r.name || payment.recipient === r.name);
      const automatic = balance < -0.01
        ? (share > 0 && balance > -share ? "Partially paid" : "Pending")
        : (hasHistory ? "Paid" : "Pending");
      const status = data.paymentStatuses[r.name] || automatic;
      const statusClass = status === "Paid" ? "paid" : status === "Partially paid" ? "partial" : "pending";
      return `<tr><td>${avatar(r.name)} <span class="ms-2">${escapeHtml(r.name)}</span></td><td>${money(share)}</td><td>${balance > 0 ? `+${money(balance)} · receive` : balance < 0 ? `${money(Math.abs(balance))} · owes` : money(0)}</td><td><select class="form-select payment-status-select" data-person="${escapeHtml(r.name)}" aria-label="Payment status for ${escapeHtml(r.name)}"><option ${status === "Paid" ? "selected" : ""}>Paid</option><option ${status === "Partially paid" ? "selected" : ""}>Partially paid</option><option ${status === "Pending" ? "selected" : ""}>Pending</option></select><span class="status ${statusClass}">${escapeHtml(status)}</span></td><td><button class="tiny-icon-button" data-action="record-payment-for" data-person="${escapeHtml(r.name)}" title="Record a payment"><i class="bi bi-plus-lg"></i></button></td></tr>`;
    }).join("");
    const history = [...data.payments].sort((a, b) => b.date.localeCompare(a.date)).map((p) => `<tr><td>${escapeHtml(p.person)}</td><td>${escapeHtml(p.recipient || "Room balance")}</td><td>${money(p.amount)}</td><td>${shortDate(p.date)}</td><td>${escapeHtml(p.method)}</td><td>${escapeHtml(p.note || "—")}</td><td><button class="tiny-icon-button" data-action="delete-payment" data-id="${p.id}" title="Delete payment"><i class="bi bi-trash3"></i></button></td></tr>`).join("");
    pageContent.innerHTML = `${heading("Payments", "See who has contributed, what’s still pending and every payment made.", `<button class="btn btn-primary" data-action="scroll-form" data-target="paymentFormCard"><i class="bi bi-plus-lg me-1"></i> Record payment</button>`)}
      <div class="module-grid"><section class="module-card span-2"><h2>Individual balances</h2><p class="module-description">Balance signs show who owes or should receive money. Select a payment status manually when needed.</p><div class="table-wrap"><table class="table"><thead><tr><th>Roommate</th><th>Rent share</th><th>Net balance</th><th>Payment status</th><th>Action</th></tr></thead><tbody>${perPerson || `<tr><td colspan="5">${empty("bi-people", "No roommates added yet.")}</td></tr>`}</tbody></table></div></section>
      <section class="module-card span-2" id="paymentFormCard"><h2>Record a payment</h2><p class="module-description">Record who paid whom. Balances update automatically for both roommates.</p><form id="paymentForm"><div class="form-grid"><div><label class="form-label" for="paymentPerson">Paid by</label><select class="form-select" id="paymentPerson" name="person" required>${roommateNames().map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("")}</select></div><div><label class="form-label" for="paymentRecipient">Paid to</label><select class="form-select" id="paymentRecipient" name="recipient" required>${data.roommates.map((r) => `<option>${escapeHtml(r.name)}</option>`).join("")}</select></div><div><label class="form-label" for="paymentAmount">Amount (₹)</label><input class="form-control" id="paymentAmount" name="amount" type="number" min="0.01" step="0.01" required></div><div><label class="form-label" for="paymentDate">Date</label><input class="form-control" id="paymentDate" name="date" type="date" required></div><div><label class="form-label" for="paymentMethod">Payment method</label><select id="paymentMethod" class="form-select" name="method"><option>UPI</option><option>Bank transfer</option><option>Cash</option><option>Other</option></select></div><div class="full"><label class="form-label" for="paymentNote">Note (optional)</label><input class="form-control" id="paymentNote" name="note"></div></div><div class="form-actions"><button class="btn btn-primary" type="submit">Save payment</button></div></form></section>
      <section class="module-card span-2"><h2>Payment history</h2><p class="module-description">Recorded transfers between roommates.</p><div class="table-wrap"><table class="table"><thead><tr><th>Paid by</th><th>Paid to</th><th>Amount</th><th>Date</th><th>Method</th><th>Note</th><th>Action</th></tr></thead><tbody>${history || `<tr><td colspan="7">${empty("bi-arrow-left-right", "No payment records available.")}</td></tr>`}</tbody></table></div></section></div>`;
  }
  function renderInventory() {
    const rows = data.inventory.map((item) => `<tr><td>${item.photo ? `<img class="inventory-thumb" src="${item.photo}" alt="${escapeHtml(item.item)}">` : ""}${escapeHtml(item.item)}${item.notes ? `<small class="d-block text-secondary">${escapeHtml(item.notes)}</small>` : ""}</td><td>${money(item.amount)}</td><td>${shortDate(item.purchased)}</td><td>${escapeHtml(item.purchasedBy || "—")}</td><td><span class="status ${item.condition === "Available" ? "available" : "pending"}">${escapeHtml(item.condition)}</span></td><td><div class="table-actions"><button class="tiny-icon-button" data-action="toggle-inventory" data-id="${item.id}" title="Toggle availability"><i class="bi bi-arrow-repeat"></i></button><button class="tiny-icon-button" data-action="delete-inventory" data-id="${item.id}" title="Delete item"><i class="bi bi-trash3"></i></button></div></td></tr>`).join("");
    pageContent.innerHTML = `${heading("Room inventory", "Know what the house already has and who brought it in.", `<button class="btn btn-primary" data-action="scroll-form" data-target="inventoryFormCard"><i class="bi bi-plus-lg me-1"></i> Add item</button>`)}
      <div class="module-grid"><section class="module-card" id="inventoryFormCard"><h2>Add an item</h2><p class="module-description">Enter the room item and its purchase details.</p><form id="inventoryForm"><div class="mb-3"><label class="form-label" for="inventoryItem">Item name</label><input class="form-control" id="inventoryItem" name="item" required></div><div class="form-grid"><div><label class="form-label" for="inventoryAmount">Purchase amount (₹)</label><input class="form-control" id="inventoryAmount" name="amount" type="number" min="0" step="0.01" required></div><div><label class="form-label" for="inventoryDate">Purchase date</label><input class="form-control" id="inventoryDate" name="purchased" type="date" required></div><div><label class="form-label" for="inventoryBy">Purchased by</label><select class="form-select" id="inventoryBy" name="purchasedBy" required>${data.roommates.map((r) => `<option>${escapeHtml(r.name)}</option>`).join("")}</select></div><div><label class="form-label" for="inventoryPhoto">Item photo</label><input class="form-control" id="inventoryPhoto" name="photo" type="file" accept="image/*"><div id="inventoryPhotoPreview" class="image-preview"></div></div><div class="full"><label class="form-label" for="inventoryNotes">Notes</label><textarea class="form-control" id="inventoryNotes" name="notes"></textarea></div></div><div class="form-actions"><button class="btn btn-primary" type="submit">Add to inventory</button></div></form></section>
      <section class="module-card"><h2>Shared essentials</h2><p class="module-description">Things your room has on hand.</p><div class="stat-value">${data.inventory.length}</div><div class="stat-foot">Items in the room inventory</div><hr class="my-4"><p class="module-description mb-0">Use the availability control when something needs replacing. Add new items as soon as they're purchased.</p></section>
      <section class="module-card span-2"><h2>Room items</h2><p class="module-description">Items and their purchase history.</p><div class="table-wrap"><table class="table"><thead><tr><th>Item / notes</th><th>Purchase amount</th><th>Purchased</th><th>Purchased by</th><th>Status</th><th>Actions</th></tr></thead><tbody>${rows || `<tr><td colspan="6">${empty("bi-box-seam", "No items added yet.")}</td></tr>`}</tbody></table></div></section></div>`;
  }
  function renderLocations() {
    const cards = data.locations.map((loc) => `<div class="place-card"><span class="place-icon"><i class="bi bi-geo-alt"></i></span><span class="place-info"><strong>${escapeHtml(loc.name)} <small>· ${escapeHtml(loc.type)}</small></strong><small>${escapeHtml(loc.address)}</small></span><a class="tiny-icon-button" href="${safeUrl(loc.link)}" target="_blank" rel="noopener noreferrer" title="Open in Google Maps"><i class="bi bi-map"></i></a><button class="tiny-icon-button" data-action="delete-location" data-id="${loc.id}" title="Delete location"><i class="bi bi-trash3"></i></button></div>`).join("");
    pageContent.innerHTML = `${heading("Places", "Save the shops and spots your housemates go to again and again.", `<button class="btn btn-primary" data-action="scroll-form" data-target="locationForm"><i class="bi bi-plus-lg me-1"></i> Add a place</button>`)}
      <div class="module-grid"><section class="module-card"><h2>Add a place</h2><p class="module-description">Include a direct Google Maps link for quick directions.</p><form id="locationForm"><div class="mb-3"><label class="form-label" for="locationName">Shop / place name</label><input class="form-control" id="locationName" name="name" required></div><div class="mb-3"><label class="form-label" for="locationType">Type</label><select class="form-select" id="locationType" name="type"><option>Groceries</option><option>Pharmacy</option><option>Restaurant</option><option>Services</option><option>Other</option></select></div><div class="mb-3"><label class="form-label" for="locationAddress">Address</label><input class="form-control" id="locationAddress" name="address" required></div><div class="mb-3"><label class="form-label" for="locationLink">Google Maps link</label><input class="form-control" id="locationLink" name="link" type="url" placeholder="https://maps.google.com/..." required></div><button class="btn btn-primary" type="submit">Save place</button></form></section>
      <section class="module-card"><h2>Saved places</h2><p class="module-description">${data.locations.length} useful spot${data.locations.length === 1 ? "" : "s"} for your room</p>${cards || empty("bi-geo-alt", "No saved places yet.")}</section></div>`;
  }
  function safeUrl(value) { try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) ? escapeHtml(url.href) : "#"; } catch { return "#"; } }
  function renderNotices() {
    const notices = [...data.notices].sort((a, b) => b.date.localeCompare(a.date)).map((n) => `<article class="notice-card"><div class="notice-card-head">${avatar(n.author)}<strong>${escapeHtml(n.author)}</strong><small>${shortDate(n.date)}</small><button class="tiny-icon-button ms-1" data-action="edit-notice" data-id="${n.id}" title="Edit notice"><i class="bi bi-pencil"></i></button><button class="tiny-icon-button" data-action="delete-notice" data-id="${n.id}" title="Delete notice"><i class="bi bi-trash3"></i></button></div><p>${escapeHtml(n.text)}</p></article>`).join("");
    pageContent.innerHTML = `${heading("Notice board", "The shared space for house updates, heads-ups and useful reminders.", `<button class="btn btn-primary" data-action="scroll-form" data-target="noticeForm"><i class="bi bi-pencil-square me-1"></i> Post a notice</button>`)}
      <div class="module-grid"><section class="module-card"><h2>Post a notice</h2><p class="module-description">Let the whole room know what's going on.</p><form id="noticeForm"><div class="mb-3"><label class="form-label" for="noticeAuthor">Posting as</label><select class="form-select" id="noticeAuthor" name="author" required>${data.roommates.map((r) => `<option>${escapeHtml(r.name)}</option>`).join("")}</select></div><div class="mb-3"><label class="form-label" for="noticeDate">Notice date</label><input class="form-control" type="date" id="noticeDate" name="date" required></div><div class="mb-3"><label class="form-label" for="noticeText">Message</label><textarea class="form-control" id="noticeText" name="text" required maxlength="500"></textarea></div><button class="btn btn-primary" type="submit">Post to the board</button></form></section>
      <section class="module-card"><h2>Room updates</h2><p class="module-description">Recent messages from your roommates.</p>${notices || empty("bi-chat-square-text", "No notices yet. Post the first one.")}</section></div>`;
  }
  function renderList() {
    const items = data.shoppingList.map((item) => `<div class="list-row ${item.done ? "done" : ""}"><input class="list-check" type="checkbox" data-action="toggle-list-item" data-id="${item.id}" ${item.done ? "checked" : ""} aria-label="Mark ${escapeHtml(item.item)} purchased"><span class="list-content"><strong>${escapeHtml(item.item)}</strong><small>${escapeHtml(item.quantity || "Quantity not set")}</small></span><button class="tiny-icon-button" data-action="edit-list-item" data-id="${item.id}" title="Edit item"><i class="bi bi-pencil"></i></button><button class="tiny-icon-button" data-action="delete-list-item" data-id="${item.id}" title="Delete item"><i class="bi bi-trash3"></i></button></div>`).join("");
    pageContent.innerHTML = `${heading("Shopping list", "Add the essentials, tick them off and keep the next shop run simple.", `<button class="btn btn-outline-secondary" data-action="clear-purchased"><i class="bi bi-check2-all me-1"></i> Clear purchased</button>`)}
      <div class="module-grid"><section class="module-card"><h2>Add to the list</h2><p class="module-description">Roommates can add items as they run low.</p><form id="listForm"><div class="mb-3"><label class="form-label" for="listItem">What do we need?</label><input class="form-control" id="listItem" name="item" required placeholder="e.g. Coffee"></div><div class="mb-3"><label class="form-label" for="listQuantity">Quantity / note</label><input class="form-control" id="listQuantity" name="quantity" placeholder="e.g. 1 bag"></div><button type="submit" class="btn btn-primary">Add to shopping list</button></form></section>
      <section class="module-card"><h2>Room shopping list <span class="muted-copy">(${data.shoppingList.filter((item) => !item.done).length} to get)</span></h2><p class="module-description">Check things off as you shop.</p>${items || empty("bi-list-check", "Your shared shopping list is clear.")}</section></div>`;
  }
  function renderReminders() {
    const rows = [...data.reminders].sort((a, b) => a.due.localeCompare(b.due)).map((r) => {
      const overdue = !r.done && r.due < getDateKey();
      return `<tr><td>${escapeHtml(r.title)}</td><td>${money(r.amount)}</td><td>${shortDate(r.due)}</td><td>${escapeHtml(r.assignedTo)}</td><td><span class="status ${r.done ? "paid" : overdue ? "overdue" : "pending"}">${r.done ? "Paid" : overdue ? "Overdue" : "Upcoming"}</span></td><td><div class="table-actions"><button class="tiny-icon-button" data-action="toggle-reminder" data-id="${r.id}" title="${r.done ? "Mark unpaid" : "Mark paid"}"><i class="bi bi-check2"></i></button><button class="tiny-icon-button" data-action="delete-reminder" data-id="${r.id}" title="Delete reminder"><i class="bi bi-trash3"></i></button></div></td></tr>`;
    }).join("");
    pageContent.innerHTML = `${heading("Reminders", "Stay ahead of bills and payment due dates with timely room reminders.", `<button class="btn btn-primary" data-action="scroll-form" data-target="reminderForm"><i class="bi bi-plus-lg me-1"></i> Add reminder</button>`)}
      <div class="module-grid"><section class="module-card"><h2>Set a reminder</h2><p class="module-description">Add a bill, amount and due date.</p><form id="reminderForm"><div class="mb-3"><label class="form-label" for="reminderTitle">Reminder title</label><input class="form-control" id="reminderTitle" name="title" required placeholder="e.g. Electricity bill"></div><div class="form-grid"><div><label class="form-label" for="reminderAmount">Amount (₹)</label><input class="form-control" id="reminderAmount" name="amount" type="number" min="0" step="0.01"></div><div><label class="form-label" for="reminderDue">Due date</label><input class="form-control" id="reminderDue" name="due" type="date" required></div><div class="full"><label class="form-label" for="reminderAssigned">Assigned to</label><select class="form-select" id="reminderAssigned" name="assignedTo"><option>Everyone</option>${data.roommates.map((r) => `<option>${escapeHtml(r.name)}</option>`).join("")}</select></div></div><div class="form-actions"><button class="btn btn-primary" type="submit">Save reminder</button></div></form></section>
      <section class="module-card"><h2>Upcoming bills</h2><p class="module-description">Dates to keep on your radar.</p><div class="stat-value">${data.reminders.filter((r) => !r.done).length}</div><div class="stat-foot">Open payment reminders</div><hr class="my-4"><p class="module-description mb-0">Mark a reminder paid when the bill is settled. Roommates can check this page anytime.</p></section>
      <section class="module-card span-2"><h2>All reminders</h2><p class="module-description">A shared overview of bills to settle.</p><div class="table-wrap"><table class="table"><thead><tr><th>Bill</th><th>Amount</th><th>Due</th><th>Assigned to</th><th>Status</th><th>Actions</th></tr></thead><tbody>${rows || `<tr><td colspan="6">${empty("bi-bell", "No reminders added yet.")}</td></tr>`}</tbody></table></div></section></div>`;
  }
  function renderLeaderboard() {
    const monthKey = getMonthKey();
    const totals = data.roommates.map((r) => ({
      ...r,
      amount: data.payments.filter((payment) => payment.person === r.name && payment.date.slice(0, 7) === monthKey).reduce((sum, payment) => sum + Number(payment.amount), 0),
      spending: data.expenses.filter((expense) => expense.paidBy === r.name && expense.date.slice(0, 7) === monthKey).reduce((sum, expense) => sum + Number(expense.amount), 0)
    })).sort((a, b) => b.amount - a.amount);
    const top = totals[0]?.amount || 0;
    const rows = totals.map((r) => `<div class="roommate-mini">${avatar(r.name)}<span class="person-info"><strong>${escapeHtml(r.name)}</strong><small>Spending ${money(r.spending)}</small><span class="person-bar"><span style="width:${top ? r.amount / top * 100 : 0}%"></span></span></span><span class="text-end"><strong class="activity-amount">${money(r.amount)}</strong><small class="d-block text-secondary">paid this month</small></span></div>`).join("");
    const hasPayments = data.payments.some((payment) => payment.date.slice(0, 7) === monthKey);
    pageContent.innerHTML = `${heading("Monthly leaderboard", "A little appreciation for the people keeping the home running.", `<span class="status partial"><i class="bi bi-calendar3 me-1"></i> ${new Date().toLocaleDateString("en-IN", { month: "long", year: "numeric" })}</span>`)}
      <div class="module-grid"><section class="module-card span-2"><h2>Room contributions</h2><p class="module-description">Monthly contributions come from actual recorded payment transfers. Spending paid is shown separately.</p>${hasPayments ? rows : empty("bi-trophy", "No payment records available.")}</section>
      <section class="module-card"><span class="stat-icon amber"><i class="bi bi-cash-coin"></i></span><div class="module-description mt-3">Payments recorded this month</div><div class="stat-value">${money(totals.reduce((sum, r) => sum + r.amount, 0))}</div><div class="stat-foot">Actual payment records only</div></section><section class="module-card"><span class="stat-icon teal"><i class="bi bi-people"></i></span><div class="module-description mt-3">Roommates</div><div class="stat-value">${data.roommates.length}</div><div class="stat-foot">${data.roommates.length ? "Members you've added" : "No roommates added yet."}</div></section></div>`;
  }
  function expenseShareFor(expense, person) {
    if (expense.shares) return Number(expense.shares[person]) || 0;
    const participants = expense.splitWith?.length ? expense.splitWith : data.roommates.map((roommate) => roommate.name);
    return participants.includes(person) ? Number(expense.amount) / participants.length : 0;
  }
  function renderHistory() {
    if (!selectedHistoryRoommate || !data.roommates.some((roommate) => roommate.name === selectedHistoryRoommate)) selectedHistoryRoommate = data.roommates[0]?.name || "";
    if (!selectedHistoryRoommate) {
      pageContent.innerHTML = `${heading("Individual expense history", "Review expense shares, payments and balances for each roommate.", "")}<section class="module-card">${empty("bi-person-lines-fill", "No roommates added yet.")}</section>`;
      return;
    }
    const person = selectedHistoryRoommate;
    const relevantExpenses = data.expenses.filter((expense) => expense.paidBy === person || expenseShareFor(expense, person) > 0);
    const sharedTotal = relevantExpenses.reduce((sum, expense) => sum + Number(expense.amount), 0);
    const personalShare = relevantExpenses.reduce((sum, expense) => sum + expenseShareFor(expense, person), 0);
    const expensesPaid = data.expenses.filter((expense) => expense.paidBy === person).reduce((sum, expense) => sum + Number(expense.amount), 0);
    const outgoingPayments = data.payments.filter((payment) => payment.person === person);
    const totalPaid = expensesPaid + outgoingPayments.reduce((sum, payment) => sum + Number(payment.amount), 0);
    const balance = balanceMap()[person] || 0;
    const transactions = [
      ...relevantExpenses.map((expense) => ({ date: expense.date, title: expense.title, type: expense.paidBy === person ? "Expense paid" : "Shared expense", amount: expense.paidBy === person ? Number(expense.amount) : expenseShareFor(expense, person), details: expense.paidBy === person ? `Paid by ${person}` : `Share of ${money(expense.amount)}` })),
      ...data.payments.filter((payment) => payment.person === person || payment.recipient === person).map((payment) => ({ date: payment.date, title: "Payment transfer", type: payment.person === person ? "Paid" : "Received", amount: Number(payment.amount), details: `${payment.person} → ${payment.recipient || "room"}` }))
    ].sort((a, b) => b.date.localeCompare(a.date));
    const rows = transactions.map((item) => `<tr><td>${shortDate(item.date)}</td><td>${escapeHtml(item.title)}</td><td>${escapeHtml(item.type)}</td><td>${escapeHtml(item.details)}</td><td>${money(item.amount)}</td></tr>`).join("");
    pageContent.innerHTML = `${heading("Individual expense history", "Shared expenses, personal shares and payment dates for each roommate.", `<select class="form-select" id="historyRoommate" aria-label="Select roommate">${data.roommates.map((roommate) => `<option ${roommate.name === person ? "selected" : ""}>${escapeHtml(roommate.name)}</option>`).join("")}</select>`)}
      <div class="stat-grid"><div class="stat-card"><div class="stat-top">Total shared expenses<span class="stat-icon purple"><i class="bi bi-receipt"></i></span></div><div class="stat-value">${money(sharedTotal)}</div><div class="stat-foot">Expenses involving ${escapeHtml(person)}</div></div><div class="stat-card"><div class="stat-top">Individual expense share<span class="stat-icon teal"><i class="bi bi-pie-chart"></i></span></div><div class="stat-value">${money(personalShare)}</div><div class="stat-foot">Calculated from each split</div></div><div class="stat-card"><div class="stat-top">Total amount paid<span class="stat-icon amber"><i class="bi bi-cash-stack"></i></span></div><div class="stat-value">${money(totalPaid)}</div><div class="stat-foot">Expenses paid + transfers sent</div></div><div class="stat-card"><div class="stat-top">Pending balance<span class="stat-icon coral"><i class="bi bi-hourglass-split"></i></span></div><div class="stat-value">${money(Math.abs(balance))}</div><div class="stat-foot">${balance < 0 ? "Owes the room" : balance > 0 ? "Should receive" : "Settled"}</div></div></div>
      <section class="module-card"><h2>Previous transactions</h2><p class="module-description">Payment dates, expenses and individual shares.</p><div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Transaction</th><th>Type</th><th>Details</th><th>Amount</th></tr></thead><tbody>${rows || `<tr><td colspan="5">${empty("bi-clock-history", "No transactions recorded for this roommate.")}</td></tr>`}</tbody></table></div></section>`;
  }
  function renderCalendar() {
    const current = new Date();
    const year = current.getFullYear();
    const month = current.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const days = new Date(year, month + 1, 0).getDate();
    const prevDays = new Date(year, month, 0).getDate();
    const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => `<div class="calendar-day-head">${day}</div>`).join("");
    let cells = "";
    for (let i = 0; i < 42; i++) {
      let dayNum, other = false, dateValue;
      if (i < firstDay) { dayNum = prevDays - firstDay + i + 1; other = true; dateValue = new Date(year, month - 1, dayNum); }
      else if (i >= firstDay + days) { dayNum = i - firstDay - days + 1; other = true; dateValue = new Date(year, month + 1, dayNum); }
      else { dayNum = i - firstDay + 1; dateValue = new Date(year, month, dayNum); }
      const key = `${dateValue.getFullYear()}-${String(dateValue.getMonth() + 1).padStart(2, "0")}-${String(dateValue.getDate()).padStart(2, "0")}`;
      const events = data.calendarEvents.filter((event) => event.date === key);
      cells += `<div class="calendar-cell ${other ? "muted" : ""}"><span class="calendar-number">${dayNum}</span>${events.map((event) => `<span class="calendar-event ${escapeHtml(event.type)}" title="${escapeHtml(event.title)}">${escapeHtml(event.title)}</span>`).join("")}</div>`;
    }
    const eventRows = [...data.calendarEvents].sort((a, b) => a.date.localeCompare(b.date)).map((e) => `<div class="activity-row"><span class="activity-icon ${e.type === "teal" ? "utilities" : e.type === "coral" ? "shopping" : "rent"}"><i class="bi bi-calendar-event"></i></span><span class="activity-info"><strong>${escapeHtml(e.title)}</strong><small>${shortDate(e.date)}</small></span><button class="tiny-icon-button" data-action="delete-event" data-id="${e.id}" title="Delete event"><i class="bi bi-trash3"></i></button></div>`).join("");
    pageContent.innerHTML = `${heading("Shared calendar", "Your room’s rent, bill and shopping dates—all in one place.", `<button class="btn btn-primary" data-action="scroll-form" data-target="calendarForm"><i class="bi bi-plus-lg me-1"></i> Add event</button>`)}
      <div class="module-grid"><section class="module-card span-2"><div class="section-heading"><div><h2>${current.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}</h2><div class="module-description mb-0">Events shared with your roommates</div></div><div class="d-flex gap-2"><button class="tiny-icon-button" data-action="calendar-shift" data-delta="-1" aria-label="Previous month"><i class="bi bi-chevron-left"></i></button><button class="tiny-icon-button" data-action="calendar-shift" data-delta="1" aria-label="Next month"><i class="bi bi-chevron-right"></i></button></div></div><div class="calendar-grid">${weekday}${cells}</div></section>
      <section class="module-card"><h2>Add a calendar event</h2><p class="module-description">Plan bill payments, shopping or room events.</p><form id="calendarForm"><div class="mb-3"><label class="form-label" for="eventTitle">Event name</label><input class="form-control" id="eventTitle" name="title" required></div><div class="mb-3"><label class="form-label" for="eventDate">Date</label><input class="form-control" id="eventDate" name="date" type="date" required></div><div class="mb-3"><label class="form-label" for="eventType">Color</label><select class="form-select" id="eventType" name="type"><option value="">Lavender</option><option value="teal">Mint</option><option value="coral">Coral</option></select></div><button class="btn btn-primary" type="submit">Add event</button></form></section>
      <section class="module-card"><h2>Upcoming plans</h2><p class="module-description">Everything happening in your room.</p>${eventRows || empty("bi-calendar3", "Your calendar is clear.")}</section></div>`;
  }
  function renderReports() {
    const reportExpenses = selectedReportExpenses();
    const total = reportExpenses.reduce((sum, e) => sum + Number(e.amount), 0);
    const categorySummary = {};
    reportExpenses.forEach((e) => { categorySummary[e.category] = (categorySummary[e.category] || 0) + Number(e.amount); });
    const summary = Object.entries(categorySummary).sort((a, b) => b[1] - a[1]).map(([category, amount]) => `<tr><td>${escapeHtml(category)}</td><td>${money(amount)}</td><td>${total ? Math.round(amount / total * 100) : 0}%</td></tr>`).join("");
    const roommateSummary = data.roommates.map((roommate) => {
      const share = reportExpenses.reduce((sum, expense) => sum + expenseShareFor(expense, roommate.name), 0);
      const paid = data.payments.filter((payment) => payment.person === roommate.name && payment.date.slice(0, 7) === reportMonth).reduce((sum, payment) => sum + Number(payment.amount), 0);
      return `<tr><td>${avatar(roommate.name)} <span class="ms-2">${escapeHtml(roommate.name)}</span></td><td>${money(share)}</td><td>${money(paid)}</td></tr>`;
    }).join("");
    const availableMonths = [...new Set([getMonthKey(), ...data.expenses.map((e) => e.date.slice(0, 7))])].sort().reverse();
    if (!availableMonths.includes(reportMonth)) reportMonth = availableMonths[0];
    const monthOptions = availableMonths.map((month) => `<option value="${month}" ${month === reportMonth ? "selected" : ""}>${new Date(`${month}-01T00:00:00`).toLocaleDateString("en-IN", { month: "long", year: "numeric" })}</option>`).join("");
    const selectedMonthLabel = new Date(`${reportMonth}-01T00:00:00`).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
    pageContent.innerHTML = `${heading("Monthly reports", "A transparent picture of what your shared home spends.", `<select class="form-select" id="reportMonth" aria-label="Report month">${monthOptions}</select><button class="btn btn-primary" data-action="download-report"><i class="bi bi-file-earmark-arrow-down me-1"></i> Export report</button>`)}
      <div class="stat-grid"><div class="stat-card"><div class="stat-top">Total expenses<span class="stat-icon purple"><i class="bi bi-wallet2"></i></span></div><div class="stat-value">${money(total)}</div><div class="stat-foot">${escapeHtml(selectedMonthLabel)}</div></div><div class="stat-card"><div class="stat-top">Roommates<span class="stat-icon teal"><i class="bi bi-people"></i></span></div><div class="stat-value">${data.roommates.length}</div><div class="stat-foot">Sharing the room</div></div><div class="stat-card"><div class="stat-top">Average per person<span class="stat-icon amber"><i class="bi bi-calculator"></i></span></div><div class="stat-value">${money(total / Math.max(data.roommates.length, 1))}</div><div class="stat-foot">Equal split estimate</div></div><div class="stat-card"><div class="stat-top">Transactions<span class="stat-icon coral"><i class="bi bi-receipt"></i></span></div><div class="stat-value">${reportExpenses.length}</div><div class="stat-foot">Shared expenses logged</div></div></div>
      <div class="module-grid"><section class="module-card span-2"><h2>Expense breakdown</h2><p class="module-description">Category totals for ${escapeHtml(selectedMonthLabel)}.</p>${reportExpenses.length ? `<div class="chart-wrap"><canvas id="reportChart" aria-label="Expense category report chart"></canvas></div>` : empty("bi-bar-chart", "No expenses added for this month.")}</section><section class="module-card span-2"><h2>Category summary</h2><p class="module-description">Spending share by category.</p><div class="table-wrap"><table class="table"><thead><tr><th>Category</th><th>Total</th><th>Share of spending</th></tr></thead><tbody>${summary || `<tr><td colspan="3">${empty("bi-bar-chart", "No expenses added for this month.")}</td></tr>`}</tbody></table></div></section><section class="module-card span-2"><h2>Individual roommate expenses</h2><p class="module-description">Monthly individual expense share and recorded payments.</p><div class="table-wrap"><table class="table"><thead><tr><th>Roommate</th><th>Expense share</th><th>Payments made</th></tr></thead><tbody>${roommateSummary || `<tr><td colspan="3">${empty("bi-people", "No roommates added yet.")}</td></tr>`}</tbody></table></div></section><section class="module-card span-2"><h2>Export your data</h2><p class="module-description">Download a print-ready report or a backup of all RoomSync data.</p><div class="d-flex flex-wrap gap-2"><button class="btn btn-primary" data-action="download-report"><i class="bi bi-file-earmark-pdf me-1"></i> Print / save as PDF</button><button class="btn btn-outline-secondary" data-action="export-json"><i class="bi bi-download me-1"></i> Download data backup</button><button class="btn btn-outline-secondary" data-action="import-json"><i class="bi bi-upload me-1"></i> Restore data backup</button><input type="file" id="importFile" accept="application/json,.json" hidden></div></section></div>`;
    createCharts();
  }
  function selectedReportExpenses() {
    return data.expenses.filter((expense) => expense.date.slice(0, 7) === reportMonth);
  }
  const renderers = { dashboard: renderDashboard, room: renderRoom, rent: renderRent, expenses: renderExpenses, shopping: renderShopping, payments: renderPayments, history: renderHistory, inventory: renderInventory, locations: renderLocations, notices: renderNotices, list: renderList, reminders: renderReminders, leaderboard: renderLeaderboard, calendar: renderCalendar, reports: renderReports };
  const pageNames = { dashboard: "Dashboard", room: "My room", rent: "Rent calculator", expenses: "Expenses", shopping: "Shopping", payments: "Payments", history: "Individual history", inventory: "Room inventory", locations: "Places", notices: "Notice board", list: "Shopping list", reminders: "Reminders", leaderboard: "Leaderboard", calendar: "Shared calendar", reports: "Reports" };
  function render(page = currentPage) {
    if (!renderers[page]) page = "dashboard";
    currentPage = page;
    document.querySelector(".room-switcher strong").textContent = data.roomName || "No room created yet";
    document.querySelector(".room-switcher small").textContent = data.roomName ? `${data.roommates.length} roommates · ${data.roomCity || "Location not set"}` : "0 roommates · get started";
    document.querySelector(".breadcrumb-label > span").textContent = data.roomName || "No room";
    document.querySelector(".profile-button strong").textContent = data.profile.name || "Your profile";
    const profileInitials = data.profile.name ? data.profile.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase() : "?";
    document.getElementById("topProfile").textContent = profileInitials;
    document.querySelector(".profile-avatar").textContent = profileInitials;
    document.querySelectorAll(".side-nav [data-page]").forEach((link) => link.classList.toggle("active", link.dataset.page === page));
    document.getElementById("breadcrumbPage").textContent = pageNames[page];
    document.getElementById("expenseNavCount").textContent = data.expenses.length;
    document.querySelector(".notification-dot").style.display = data.reminders.some((reminder) => !reminder.done) ? "block" : "none";
    renderers[page]();
    const manualSelects = {
      expenseCategory: "Choose a category",
      expensePayer: "Choose who paid",
      shopPurchaser: "Choose who purchased",
      paymentPerson: "Choose who paid",
      paymentRecipient: "Choose who received",
      paymentMethod: "Choose a payment method",
      inventoryBy: "Choose who purchased",
      noticeAuthor: "Choose a roommate",
      reminderAssigned: "Choose who this is for"
    };
    Object.entries(manualSelects).forEach(([selectId, label]) => {
      const select = document.getElementById(selectId);
      if (!select) return;
      const placeholder = new Option(label, "", true, true);
      placeholder.disabled = true;
      select.add(placeholder, 0);
      select.value = "";
    });
    pageContent.querySelectorAll('#expenseForm [name="splitWith"]').forEach((input) => { input.checked = false; });
    updateExpenseSplitUi();
    document.getElementById("sidebar").classList.remove("open");
  }
  function updateUnequalTotal() {
    const inputs = [...document.querySelectorAll(".rent-percent")];
    if (!inputs.length) return;
    const total = inputs.reduce((sum, input) => sum + (Number(input.value) || 0), 0);
    document.getElementById("percentTotal").textContent = `${total}%`;
    document.getElementById("percentTotal").style.color = total === 100 ? "var(--teal)" : "var(--coral)";
    const result = document.getElementById("unequalResults");
    result.innerHTML = inputs.map((input) => {
      const member = data.roommates.find((r) => r.id === input.name);
      return `<div class="d-flex justify-content-between small py-1"><span class="text-secondary">${escapeHtml(member?.name || "Roommate")}</span><strong>${money(data.rent * (Number(input.value) || 0) / 100)}</strong></div>`;
    }).join("");
  }
  function updateExpenseSplitUi() {
    const form = document.getElementById("expenseForm");
    if (!form) return;
    const selected = [...form.querySelectorAll('[name="splitWith"]:checked')].map((input) => input.value);
    const custom = form.querySelector("#expenseSplitMode").value === "custom";
    const container = form.querySelector(".custom-expense-split");
    container.hidden = !custom;
    if (!custom) return;
    const existing = new Map([...form.querySelectorAll(".expense-percent")].map((input) => [input.dataset.person, input.value]));
    const base = selected.length ? Math.floor(100 / selected.length) : 0;
    const remainder = selected.length ? 100 - base * selected.length : 0;
    const content = selected.map((name, index) => {
      const defaultValue = base + (index === selected.length - 1 ? remainder : 0);
      const percent = existing.has(name) ? existing.get(name) : defaultValue;
      return `<label class="checkbox-item split-row"><span>${escapeHtml(name)}</span><span class="input-group input-group-sm"><input class="form-control expense-percent" data-person="${escapeHtml(name)}" type="number" min="0" max="100" step="0.01" value="${escapeHtml(percent)}" aria-label="${escapeHtml(name)} percentage"><span class="input-group-text">%</span></span></label>`;
    }).join("");
    form.querySelector(".custom-expense-shares").innerHTML = content || empty("bi-people", "Select roommates to split this expense.");
    updateExpenseSplitTotal();
  }
  function updateExpenseSplitTotal() {
    const form = document.getElementById("expenseForm");
    if (!form) return;
    const total = [...form.querySelectorAll(".expense-percent")].reduce((sum, input) => sum + (Number(input.value) || 0), 0);
    const label = form.querySelector(".expense-percent-total");
    if (!label) return;
    label.textContent = `${Number(total.toFixed(2))}%`;
    label.style.color = Math.abs(total - 100) < 0.001 ? "var(--teal)" : "var(--coral)";
  }
  function scrollToForm(target) { document.getElementById(target)?.scrollIntoView({ behavior: "smooth", block: "center" }); }
  function addExpenseButton() { render("expenses"); window.setTimeout(() => scrollToForm("expenseFormCard"), 30); }
  async function filesToDataUrls(files) {
    const selected = [...files];
    if (selected.some((file) => !file.type.startsWith("image/"))) throw new Error("Please choose image files only.");
    if (selected.some((file) => file.size > 2 * 1024 * 1024)) throw new Error("Each image must be 2 MB or smaller.");
    return Promise.all(selected.map((file) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
      reader.readAsDataURL(file);
    })));
  }
  async function previewFiles(input, preview) {
    preview.innerHTML = "";
    try {
      const images = await filesToDataUrls(input.files);
      images.forEach((src) => { const img = document.createElement("img"); img.src = src; img.alt = "Image preview"; preview.append(img); });
    } catch (error) { input.value = ""; toast(error.message, "danger"); }
  }
  async function uploadImages(files) {
    const selected = [...files];
    if (!selected.length) return [];
    if (selected.some((file) => !file.type.startsWith("image/"))) throw new Error("Please choose image files only.");
    if (selected.some((file) => file.size > 2 * 1024 * 1024)) throw new Error("Each image must be 2 MB or smaller.");
    if (!data.roomId) throw new Error("Create your room before uploading images.");
    const form = new FormData();
    form.append("roomId", data.roomId);
    selected.forEach((file) => form.append("images", file));
    const result = await apiRequest("/uploads/images", { method: "POST", body: form });
    return result.files.map((file) => file.url);
  }
  async function saveRoommatePhoto(input) {
    const roommate = data.roommates.find((person) => person.id === input.dataset.id);
    if (!roommate || !input.files?.length) return;
    try {
      [roommate.photo] = await uploadImages(input.files);
      persist(); render(); toast("Roommate photo saved.");
    } catch (error) { toast(error.message, "danger"); }
  }
  async function savePaymentStatus(select) {
    data.paymentStatuses[select.dataset.person] = select.value;
    persist();
    render("payments");
    toast("Payment status updated.");
  }
  function download(name, content, type) {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([content], { type }));
    link.download = name;
    document.body.append(link); link.click(); link.remove();
    URL.revokeObjectURL(link.href);
  }
  function exportReport() {
    const reportExpenses = currentPage === "reports" ? selectedReportExpenses() : data.expenses;
    const reportTitle = currentPage === "reports" ? new Date(`${reportMonth}-01T00:00:00`).toLocaleDateString("en-IN", { month: "long", year: "numeric" }) : "All recorded expenses";
    const rows = reportExpenses.map((e) => `<tr><td>${escapeHtml(e.title)}</td><td>${escapeHtml(e.category)}</td><td>${shortDate(e.date)}</td><td>${escapeHtml(e.paidBy)}</td><td>${money(e.amount)}</td></tr>`).join("");
    const printWindow = window.open("", "_blank");
    if (!printWindow) { toast("Please allow pop-ups to print or save your report.", "danger"); return; }
    printWindow.document.write(`<!doctype html><html><head><title>RoomSync expense report</title><style>body{font:14px Arial,sans-serif;color:#202b3c;margin:40px}h1{color:#6259d9}p{color:#667085}table{width:100%;border-collapse:collapse;margin-top:25px}th,td{text-align:left;padding:10px;border-bottom:1px solid #e5e7eb}th{font-size:11px;text-transform:uppercase;color:#647187}strong{font-size:20px}.brand{font-weight:bold;font-size:18px;color:#6259d9}@media print{button{display:none}}</style></head><body><div class="brand">⌂ RoomSync</div><h1>Room expense report</h1><p>${escapeHtml(data.roomName)} · ${escapeHtml(reportTitle)} · Generated ${new Date().toLocaleDateString("en-IN")}</p><p><strong>Total expenses: ${money(reportExpenses.reduce((sum, e) => sum + Number(e.amount), 0))}</strong></p><table><thead><tr><th>Expense</th><th>Category</th><th>Date</th><th>Paid by</th><th>Amount</th></tr></thead><tbody>${rows}</tbody></table><script>window.onload=()=>window.print()<\/script></body></html>`);
    printWindow.document.close();
  }
  function runAction(action, target) {
    switch (action) {
      case "open-add-expense": addExpenseButton(); break;
      case "show-form": scrollToForm(target); break;
      case "scroll-form": scrollToForm(target); break;
      case "filter-expenses": expenseFilter = target; render("expenses"); break;
      case "delete-expense": removeById("expenses", target, "Expense deleted."); break;
      case "delete-shopping": removeById("shopping", target, "Purchase deleted."); break;
      case "delete-payment": removeById("payments", target, "Payment removed."); break;
      case "delete-inventory": removeById("inventory", target, "Item removed."); break;
      case "delete-location": removeById("locations", target, "Place removed."); break;
      case "delete-notice": removeById("notices", target, "Notice deleted."); break;
      case "delete-reminder": removeById("reminders", target, "Reminder deleted."); break;
      case "delete-event": removeById("calendarEvents", target, "Calendar event deleted."); break;
      case "delete-list-item": removeById("shoppingList", target, "List item deleted."); break;
      case "clear-purchased": data.shoppingList = data.shoppingList.filter((item) => !item.done); persist(); render(); toast("Purchased items cleared."); break;
      case "toggle-list-item": { const item = data.shoppingList.find((x) => x.id === target); if (item) { item.done = !item.done; persist(); render(); } break; }
      case "edit-list-item": editListItem(target); break;
      case "toggle-reminder": { const reminder = data.reminders.find((x) => x.id === target); if (reminder) { reminder.done = !reminder.done; persist(); render(); toast(reminder.done ? "Reminder marked paid." : "Reminder marked unpaid."); } break; }
      case "toggle-inventory": { const item = data.inventory.find((x) => x.id === target); if (item) { item.condition = item.condition === "Available" ? "Needs replacing" : "Available"; persist(); render(); } break; }
      case "reset-rent": data.rentSplit = {}; persist(); render("rent"); toast("Equal split restored."); break;
      case "record-payment-for": { render("payments"); const select = document.getElementById("paymentPerson"); if (select) select.value = target; scrollToForm("paymentFormCard"); break; }
      case "view-images": showExpenseImages(target); break;
      case "edit-roommate": editRoommate(target); break;
      case "delete-roommate": deleteRoommate(target); break;
      case "edit-notice": editNotice(target); break;
      case "download-report": exportReport(); break;
      case "export-json": download("roomsync-backup.json", JSON.stringify(data, null, 2), "application/json"); break;
      case "import-json": document.getElementById("importFile")?.click(); break;
      case "calendar-shift": shiftCalendar(Number(target)); break;
    }
  }
  function removeById(collection, target, message) {
    data[collection] = data[collection].filter((item) => item.id !== target);
    persist(); render(); toast(message);
  }
  function editRoommate(target) {
    const roommate = data.roommates.find((person) => person.id === target);
    if (!roommate) return;
    const updatedName = window.prompt("Update roommate name:", roommate.name);
    if (updatedName === null) return;
    const name = updatedName.trim();
    if (!name) { toast("Roommate name cannot be empty.", "danger"); return; }
    if (data.roommates.some((person) => person.id !== target && person.name.toLowerCase() === name.toLowerCase())) { toast("A roommate with that name already exists.", "danger"); return; }
    const updatedRole = window.prompt("Role (Roommate or Room admin):", roommate.role);
    if (updatedRole === null) return;
    const role = updatedRole.trim();
    if (!["Roommate", "Room admin"].includes(role)) { toast("Choose Roommate or Room admin as the role.", "danger"); return; }
    const oldName = roommate.name;
    roommate.name = name;
    roommate.role = role;
    data.expenses.forEach((expense) => {
      if (expense.paidBy === oldName) expense.paidBy = name;
      expense.splitWith = (expense.splitWith || []).map((person) => person === oldName ? name : person);
      if (expense.shares?.[oldName] !== undefined) {
        expense.shares[name] = expense.shares[oldName];
        delete expense.shares[oldName];
      }
    });
    data.payments.forEach((payment) => {
      if (payment.person === oldName) payment.person = name;
      if (payment.recipient === oldName) payment.recipient = name;
    });
    data.shopping.forEach((purchase) => { if (purchase.purchaser === oldName) purchase.purchaser = name; });
    data.inventory.forEach((item) => { if (item.purchasedBy === oldName) item.purchasedBy = name; });
    data.notices.forEach((notice) => { if (notice.author === oldName) notice.author = name; });
    data.reminders.forEach((reminder) => { if (reminder.assignedTo === oldName) reminder.assignedTo = name; });
    if (data.profile.name === oldName) data.profile.name = name;
    if (data.paymentStatuses[oldName]) {
      data.paymentStatuses[name] = data.paymentStatuses[oldName];
      delete data.paymentStatuses[oldName];
    }
    persist(); render(); toast("Roommate details updated.");
  }
  function deleteRoommate(target) {
    const roommate = data.roommates.find((person) => person.id === target);
    if (!roommate) return;
    if (!window.confirm(`Remove ${roommate.name} from this room? Their past expenses and payments will remain in the history.`)) return;
    data.roommates = data.roommates.filter((person) => person.id !== target);
    delete data.paymentStatuses[roommate.name];
    data.rentSplit = {};
    persist(); render(); toast(`${roommate.name} removed from the room.`);
  }
  function editListItem(target) {
    const item = data.shoppingList.find((x) => x.id === target);
    if (!item) return;
    const name = window.prompt("Update item name:", item.item);
    if (name === null) return;
    const trimmed = name.trim();
    if (!trimmed) { toast("Item name cannot be empty.", "danger"); return; }
    item.item = trimmed;
    const quantity = window.prompt("Update quantity / note:", item.quantity || "");
    if (quantity !== null) item.quantity = quantity.trim();
    persist(); render(); toast("Shopping list item updated.");
  }
  function showExpenseImages(target) {
    const expense = data.expenses.find((e) => e.id === target);
    if (!expense?.images?.length) { toast("No images are attached to this expense.", "danger"); return; }
    const modal = document.createElement("div");
    modal.className = "modal fade";
    modal.innerHTML = `<div class="modal-dialog modal-dialog-centered"><div class="modal-content"><div class="modal-header"><h5 class="modal-title">${escapeHtml(expense.title)} images</h5><button type="button" class="btn-close" data-bs-dismiss="modal"></button></div><div class="modal-body d-flex flex-wrap gap-2">${expense.images.map((src) => `<img src="${src}" alt="Expense receipt" style="max-width:100%;max-height:65vh;object-fit:contain">`).join("")}</div></div></div>`;
    document.body.append(modal);
    const instance = new bootstrap.Modal(modal);
    modal.addEventListener("hidden.bs.modal", () => { instance.dispose(); modal.remove(); });
    instance.show();
  }
  let calendarOffset = 0;
  function shiftCalendar(delta) {
    calendarOffset += delta;
    const anchor = new Date(new Date().getFullYear(), new Date().getMonth() + calendarOffset, 1);
    const month = anchor.getMonth(), year = anchor.getFullYear(), firstDay = new Date(year, month, 1).getDay(), days = new Date(year, month + 1, 0).getDate(), prevDays = new Date(year, month, 0).getDate();
    const cells = [...document.querySelectorAll(".calendar-cell")];
    cells.forEach((cell, index) => {
      let dayNum, other = false, dateValue;
      if (index < firstDay) { dayNum = prevDays - firstDay + index + 1; other = true; dateValue = new Date(year, month - 1, dayNum); }
      else if (index >= firstDay + days) { dayNum = index - firstDay - days + 1; other = true; dateValue = new Date(year, month + 1, dayNum); }
      else { dayNum = index - firstDay + 1; dateValue = new Date(year, month, dayNum); }
      const key = `${dateValue.getFullYear()}-${String(dateValue.getMonth() + 1).padStart(2, "0")}-${String(dateValue.getDate()).padStart(2, "0")}`;
      cell.classList.toggle("muted", other);
      const events = data.calendarEvents.filter((event) => event.date === key);
      cell.innerHTML = `<span class="calendar-number">${dayNum}</span>${events.map((event) => `<span class="calendar-event ${escapeHtml(event.type)}" title="${escapeHtml(event.title)}">${escapeHtml(event.title)}</span>`).join("")}`;
    });
    document.querySelector(".section-heading h2").textContent = anchor.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  }
  async function handleForm(form) {
    const fields = new FormData(form);
    switch (form.id) {
      case "createRoomForm":
        data.roomName = fields.get("roomName").trim();
        data.roomCity = fields.get("roomCity").trim();
        if (!data.roomName) { toast("Enter a room name to continue.", "danger"); return; }
        try {
          data = { ...initialData(), ...await apiRequest("/workspace", { method: "PUT", body: data }) };
          persist(); render("room"); toast("Your room has been created.");
        } catch (error) { toast(error.message, "danger"); }
        break;
      case "roomDetailsForm":
        data.roomName = fields.get("roomName").trim() || data.roomName;
        data.roomCity = fields.get("roomCity").trim() || data.roomCity;
        persist(); toast("Room details saved."); render(); break;
      case "addRoommateForm": {
        if (data.roommates.length >= 10) { toast("A room can have a maximum of 10 roommates.", "danger"); return; }
        const name = fields.get("name").trim();
        if (!name) { toast("Enter a roommate name.", "danger"); return; }
        if (data.roommates.some((r) => r.name.toLowerCase() === name.toLowerCase())) { toast("That roommate is already in your room.", "danger"); return; }
        data.roommates.push({ id: id(), name, role: fields.get("role"), color: COLORS[data.roommates.length % COLORS.length] });
        data.rentSplit = {};
        persist(); render(); toast(`${name} added to your room.`); break;
      }
      case "rentForm": {
        const rent = Number(fields.get("rent"));
        if (rent < 0) { toast("Rent cannot be negative.", "danger"); return; }
        data.rent = rent;
        data.rentDueDate = fields.get("rentDueDate");
        persist(); render(); toast("Rent details saved."); break;
      }
      case "unequalRentForm": {
        const inputs = [...form.querySelectorAll(".rent-percent")];
        const total = inputs.reduce((sum, input) => sum + (Number(input.value) || 0), 0);
        if (!inputs.length || inputs.some((input) => Number(input.value) < 0 || Number(input.value) > 100) || Math.abs(total - 100) > 0.001) { toast("Roommate percentages must add up to exactly 100%.", "danger"); return; }
        data.rentSplit = Object.fromEntries(inputs.map((input) => [input.name, Number(input.value)]));
        persist();
        render("rent"); toast("Custom rent split saved."); break;
      }
      case "expenseForm":
        if (!data.roommates.length) { toast("Create a room and add roommates before recording shared expenses.", "danger"); return; }
        saveExpense(form, fields); break;
      case "shoppingForm": saveShopping(form, fields); break;
      case "paymentForm": {
        if (!data.roommates.length) { toast("Add roommates before recording payments.", "danger"); return; }
        if (fields.get("person") === fields.get("recipient")) { toast("Choose a different roommate as the payment recipient.", "danger"); return; }
        data.payments.push({ id: id(), person: fields.get("person"), recipient: fields.get("recipient"), amount: Number(fields.get("amount")), date: fields.get("date"), method: fields.get("method"), note: fields.get("note").trim() });
        persist(); render(); toast("Payment recorded and balances updated."); break;
      }
      case "inventoryForm": saveInventory(form, fields); break;
      case "locationForm": {
        const link = fields.get("link").trim();
        if (!/^https?:\/\//i.test(link)) { toast("Enter a valid Google Maps URL.", "danger"); return; }
        data.locations.push({ id: id(), name: fields.get("name").trim(), address: fields.get("address").trim(), link, type: fields.get("type") });
        persist(); render(); toast("Place saved."); break;
      }
      case "noticeForm":
        data.notices.push({ id: id(), author: fields.get("author"), text: fields.get("text").trim(), date: fields.get("date") });
        persist(); render(); toast("Your notice has been posted."); break;
      case "listForm":
        data.shoppingList.push({ id: id(), item: fields.get("item").trim(), quantity: fields.get("quantity").trim(), done: false });
        persist(); render(); toast("Added to the shopping list."); break;
      case "reminderForm":
        data.reminders.push({ id: id(), title: fields.get("title").trim(), amount: Number(fields.get("amount") || 0), due: fields.get("due"), assignedTo: fields.get("assignedTo"), done: false });
        persist(); render(); toast("Reminder saved."); break;
      case "calendarForm":
        data.calendarEvents.push({ id: id(), title: fields.get("title").trim(), date: fields.get("date"), type: fields.get("type") });
        persist(); render(); toast("Calendar event added."); break;
      case "authForm": {
        await authenticateUser(fields);
        break;
      }
    }
  }
  async function saveExpense(form, fields) {
    try {
      const files = await uploadImages(form.querySelector('[name="images"]').files);
      const splitWith = fields.getAll("splitWith");
      if (!splitWith.length) { toast("Select at least one roommate to split this expense.", "danger"); return; }
      const amount = Number(fields.get("amount"));
      let shares;
      if (fields.get("splitMode") === "custom") {
        const percentages = [...form.querySelectorAll(".expense-percent")];
        const total = percentages.reduce((sum, input) => sum + (Number(input.value) || 0), 0);
        if (percentages.length !== splitWith.length || percentages.some((input) => Number(input.value) < 0 || Number(input.value) > 100) || Math.abs(total - 100) > 0.001) {
          toast("Custom roommate percentages must add up to exactly 100%.", "danger"); return;
        }
        shares = Object.fromEntries(percentages.map((input) => [input.dataset.person, amount * Number(input.value) / 100]));
      }
      data.expenses.push({ id: id(), title: fields.get("title").trim(), category: fields.get("category"), amount, date: fields.get("date"), paidBy: fields.get("paidBy"), splitWith, ...(shares ? { shares } : {}), note: fields.get("note").trim(), images: files });
      persist(); render(); toast("Expense saved and split updated.");
    } catch (error) { toast(error.message, "danger"); }
  }
  async function saveShopping(form, fields) {
    try {
      const itemPhoto = (await uploadImages(form.querySelector('[name="itemPhoto"]').files))[0] || "";
      const billImages = await uploadImages(form.querySelector('[name="billImages"]').files);
      const shopLocation = fields.get("shopLocation").trim();
      if (shopLocation && !/^https?:\/\//i.test(shopLocation)) { toast("Enter a valid shop location URL.", "danger"); return; }
      data.shopping.push({ id: id(), item: fields.get("item").trim(), amount: Number(fields.get("amount")), date: fields.get("date"), shop: fields.get("shop").trim(), shopLocation, purchaser: fields.get("purchaser"), itemPhoto, billImages });
      persist(); render(); toast("Purchase saved.");
    } catch (error) { toast(error.message, "danger"); }
  }
  async function saveInventory(form, fields) {
    try {
      const photo = (await uploadImages(form.querySelector('[name="photo"]').files))[0] || "";
      data.inventory.push({ id: id(), item: fields.get("item").trim(), amount: Number(fields.get("amount")), purchased: fields.get("purchased"), purchasedBy: fields.get("purchasedBy"), notes: fields.get("notes").trim(), photo, condition: "Available" });
      persist(); render(); toast("Item added to the room inventory.");
    } catch (error) { toast(error.message, "danger");     }
  }
  function removeInlineImages(value) {
    if (typeof value === "string") return value.startsWith("data:image/") ? "" : value;
    if (Array.isArray(value)) return value.map(removeInlineImages).filter(Boolean);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, removeInlineImages(item)]));
    return value;
  }
  async function importPreviousDeviceData(user) {
    const marker = `roomsync-imported-${user.id}`;
    if (localStorage.getItem(marker)) return false;
    localStorage.setItem(marker, "1");
    let previous;
    try { previous = JSON.parse(localStorage.getItem(STORE_KEY) || "null"); }
    catch (error) {
      console.error("Could not read the previous RoomSync local workspace:", error);
      return false;
    }
    if (!previous || Number(previous.schemaVersion || 0) < SCHEMA_VERSION || !previous.roomName) return false;
    const hasEntries = ["roommates", "expenses", "payments", "shopping", "inventory", "notices", "shoppingList", "reminders", "calendarEvents", "locations"]
      .some((key) => Array.isArray(previous[key]) && previous[key].length);
    if (!hasEntries && !previous.rent) return false;
    const accepted = window.confirm("A previous RoomSync workspace is saved on this device. Import it into this account? It will be uploaded to your RoomSync server.");
    if (!accepted) return false;
    data = removeInlineImages({ ...initialData(), ...previous, profile: { name: user.name, email: user.email }, schemaVersion: SCHEMA_VERSION });
    data = { ...initialData(), ...await apiRequest("/workspace", { method: "PUT", body: data }) };
    localStorage.setItem(marker, "1");
    return true;
  }
  async function authenticateUser(fields) {
    const register = document.querySelector('.auth-tab[data-auth="register"]').classList.contains("active");
    const submit = document.getElementById("authSubmit");
    const original = submit.innerHTML;
    submit.disabled = true;
    submit.textContent = register ? "Creating account…" : "Signing in…";
    try {
      const session = await apiRequest(`/auth/${register ? "register" : "login"}`, {
        method: "POST",
        body: { name: fields.get("name"), email: fields.get("email"), password: fields.get("password") }
      });
      localStorage.setItem(TOKEN_KEY, session.token);
      authUser = session.user;
      data = { ...initialData(), ...await apiRequest("/workspace") };
      data.profile = { name: authUser.name, email: authUser.email };
      await importPreviousDeviceData(authUser);
      updateAccountUi();
      bootstrap.Modal.getInstance(document.getElementById("authModal"))?.hide();
      render();
      toast(`Welcome to RoomSync, ${authUser.name}.`);
    } catch (error) {
      localStorage.removeItem(TOKEN_KEY);
      authUser = null;
      toast(error.message, "danger");
    } finally {
      submit.disabled = false;
      submit.innerHTML = original;
    }
  }
  function updateAccountUi() {
    const loggedIn = Boolean(authUser);
    document.getElementById("authLogout").hidden = !loggedIn;
    document.querySelector(".auth-demo-note").innerHTML = loggedIn
      ? `<i class="bi bi-shield-check"></i> Signed in as ${escapeHtml(authUser.email)}. Your room data is stored securely on the server.`
      : '<i class="bi bi-shield-lock"></i> Sign in or create an account to save your room data securely.';
    document.querySelector(".profile-button small").textContent = loggedIn ? "Account & sign out" : "Sign in to RoomSync";
  }
  async function restoreSession() {
    try {
      const result = await apiRequest("/auth/me");
      authUser = result.user;
      data = { ...initialData(), ...await apiRequest("/workspace") };
      data.profile = { name: authUser.name, email: authUser.email };
      await importPreviousDeviceData(authUser);
      updateAccountUi();
      render();
    } catch (error) {
      localStorage.removeItem(TOKEN_KEY);
      authUser = null;
      data = initialData();
      updateAccountUi();
      render();
      toast(`Your session could not be restored: ${error.message}`, "danger");
      bootstrap.Modal.getOrCreateInstance(document.getElementById("authModal")).show();
    }
  }
  async function logout() {
    const button = document.getElementById("authLogout");
    button.disabled = true;
    let logoutError = null;
    try { await apiRequest("/auth/logout", { method: "POST", body: {} }); }
    catch (error) { logoutError = error; }
    localStorage.removeItem(TOKEN_KEY);
    authUser = null;
    data = initialData();
    updateAccountUi();
    bootstrap.Modal.getInstance(document.getElementById("authModal"))?.hide();
    render("dashboard");
    if (logoutError) toast(`Signed out on this device, but server logout failed: ${logoutError.message}`, "warning");
    else toast("You have been signed out.");
    button.disabled = false;
    bootstrap.Modal.getOrCreateInstance(document.getElementById("authModal")).show();
  }
  function setAuthMode(mode) {
    const register = mode === "register";
    document.querySelectorAll(".auth-tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.auth === mode));
    document.getElementById("authName").hidden = !register;
    document.getElementById("authNameLabel").hidden = !register;
    document.getElementById("authName").required = register;
    document.getElementById("authTitle").textContent = register ? "Create your account" : "Welcome to RoomSync";
    document.getElementById("authSubmit").innerHTML = `${register ? "Create account" : "Sign in to RoomSync"} <i class="bi bi-arrow-right ms-1"></i>`;
    document.getElementById("authPassword").value = "";
  }
  function setTheme(theme) {
    document.body.classList.toggle("dark-mode", theme === "dark");
    data.theme = theme;
    document.getElementById("themeToggle").innerHTML = `<i class="bi ${theme === "dark" ? "bi-sun" : "bi-moon-stars"}"></i>`;
    persist();
    if (document.getElementById("spendChart") || document.getElementById("categoryChart") || document.getElementById("reportChart")) createCharts();
  }
  document.addEventListener("click", (event) => {
    const pageLink = event.target.closest("[data-page]");
    if (pageLink) {
      event.preventDefault();
      if (pageLink.dataset.page === "history" && pageLink.dataset.roommate) selectedHistoryRoommate = pageLink.dataset.roommate;
      render(pageLink.dataset.page);
      return;
    }
    const action = event.target.closest("[data-action]");
    if (action) {
      if (action.dataset.action === "toggle-list-item") { const item = data.shoppingList.find((x) => x.id === action.dataset.id); if (item) { item.done = action.checked; persist(); render(); } return; }
      runAction(action.dataset.action, action.dataset.id || action.dataset.target || action.dataset.filter || action.dataset.delta || action.dataset.person || action.dataset.form);
    }
  });
  document.addEventListener("submit", (event) => {
    const form = event.target.closest("form");
    if (!form) return;
    event.preventDefault();
    if (!authUser && form.id !== "authForm") {
      toast("Sign in to save changes to your room.", "warning");
      bootstrap.Modal.getOrCreateInstance(document.getElementById("authModal")).show();
      return;
    }
    handleForm(form).catch((error) => toast(error.message, "danger"));
  });
  document.addEventListener("input", (event) => {
    if (event.target.classList.contains("rent-percent")) updateUnequalTotal();
    if (event.target.classList.contains("expense-percent")) updateExpenseSplitTotal();
  });
  document.getElementById("menuToggle").addEventListener("click", () => document.getElementById("sidebar").classList.toggle("open"));
  document.getElementById("themeToggle").addEventListener("click", () => setTheme(document.body.classList.contains("dark-mode") ? "light" : "dark"));
  document.getElementById("todayLabel").textContent = new Date().toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
  document.getElementById("profileButton").addEventListener("click", () => { setAuthMode("login"); bootstrap.Modal.getOrCreateInstance(document.getElementById("authModal")).show(); });
  document.getElementById("topProfile").addEventListener("click", () => { setAuthMode("login"); bootstrap.Modal.getOrCreateInstance(document.getElementById("authModal")).show(); });
  document.getElementById("authLogout").addEventListener("click", logout);
  document.querySelectorAll(".auth-tab").forEach((tab) => tab.addEventListener("click", () => setAuthMode(tab.dataset.auth)));
  pageContent.addEventListener("change", (event) => {
    if (["expenseImages", "itemPhoto", "billImages", "inventoryPhoto"].includes(event.target.id)) {
      const previews = { expenseImages: "expenseImagePreview", itemPhoto: "itemPhotoPreview", billImages: "billImagesPreview", inventoryPhoto: "inventoryPhotoPreview" };
      previewFiles(event.target, document.getElementById(previews[event.target.id]));
    }
    if (event.target.id === "expenseSplitMode" || event.target.name === "splitWith") updateExpenseSplitUi();
    if (event.target.id === "reportMonth") { reportMonth = event.target.value; render("reports"); }
    if (event.target.id === "historyRoommate") { selectedHistoryRoommate = event.target.value; render("history"); }
    if (event.target.matches(".roommate-photo-input")) saveRoommatePhoto(event.target);
    if (event.target.matches(".payment-status-select")) savePaymentStatus(event.target);
  });
  document.addEventListener("change", async (event) => {
    if (event.target.id !== "importFile") return;
    const file = event.target.files[0];
    if (!file) return;
    try {
      const imported = JSON.parse(await file.text());
      if (!Array.isArray(imported.roommates) || !Array.isArray(imported.expenses) || !Array.isArray(imported.payments)) throw new Error("This file is not a valid RoomSync backup.");
      data = { ...initialData(), ...imported };
      persist(); render(); toast("RoomSync data restored.");
    } catch (error) { toast(error.message || "Could not read this backup file.", "danger"); }
    event.target.value = "";
  });
  document.body.classList.toggle("dark-mode", data.theme === "dark");
  document.getElementById("themeToggle").innerHTML = `<i class="bi ${data.theme === "dark" ? "bi-sun" : "bi-moon-stars"}"></i>`;
  updateAccountUi();
  render("dashboard");
  if (localStorage.getItem(TOKEN_KEY)) restoreSession();
  else bootstrap.Modal.getOrCreateInstance(document.getElementById("authModal")).show();
})();
