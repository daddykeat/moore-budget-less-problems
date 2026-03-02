// app.js
// Moore Budget Less Problems (Consolidated)
// Fix: prevent full re-render on every keystroke (mobile keyboard closing).
// - Any pay schedule via payDates list
// - Debt/Invest toggles
// - Multiple profiles
// - Payoff sim w/ daily compounding interest (monthly steps)
// - PDF generator
// - Due date cluster heatmap
// - Net worth timeline
// - 30-day cashflow calendar
// - LocalStorage + Export/Import JSON

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const money = (n) => {
  const v = Number(n || 0);
  return v.toLocaleString(undefined, { style: "currency", currency: "USD" });
};

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

function todayISO() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function fmtDate(d) {
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function monthKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function nextMonthlyDate(dueDay, fromDate) {
  const base = new Date(fromDate);
  const y = base.getFullYear();
  const m = base.getMonth();
  const day = clamp(Number(dueDay || 1), 1, 28);
  let candidate = new Date(y, m, day);
  if (candidate < startOfDay(base)) candidate = new Date(y, m + 1, day);
  return candidate;
}

function uniqSortDates(arr) {
  const set = new Set(arr.map((x) => String(x).trim()).filter(Boolean));
  return [...set].sort((a, b) => new Date(a) - new Date(b));
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function toISODateLoose(s) {
  const t = String(s || "").trim();
  if (!t) return null;

  const isoMatch = t.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
  if (isoMatch) {
    const y = Number(isoMatch[1]);
    const m = Number(isoMatch[2]);
    const d = Number(isoMatch[3]);
    if (y > 1900 && m >= 1 && m <= 12 && d >= 1 && d <= 31) return `${y}-${pad2(m)}-${pad2(d)}`;
  }

  const usMatch = t.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{2,4})$/);
  if (usMatch) {
    let m = Number(usMatch[1]);
    let d = Number(usMatch[2]);
    let y = Number(usMatch[3]);
    if (y < 100) y = 2000 + y;
    if (y > 1900 && m >= 1 && m <= 12 && d >= 1 && d <= 31) return `${y}-${pad2(m)}-${pad2(d)}`;
  }

  const dt = new Date(t);
  if (!isNaN(dt)) {
    const y = dt.getFullYear();
    const m = dt.getMonth() + 1;
    const d = dt.getDate();
    return `${y}-${pad2(m)}-${pad2(d)}`;
  }
  return null;
}

function cleanDatePaste(raw) {
  const parts = String(raw || "")
    .split(/[\n,;]+/g)
    .map((x) => x.trim())
    .filter(Boolean);

  const out = [];
  for (const p of parts) {
    const iso = toISODateLoose(p);
    if (iso) out.push(iso);
  }
  return uniqSortDates(out);
}

// ----------------- Profiles -----------------
const PROFILE_INDEX_KEY = "dwr_profiles_index";
let activeProfile = localStorage.getItem("dwr_active_profile") || "Default";
function keyFor(profile) {
  return `dwr_profile_${profile}`;
}

function loadProfiles() {
  try {
    return JSON.parse(localStorage.getItem(PROFILE_INDEX_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveProfiles(list) {
  localStorage.setItem(PROFILE_INDEX_KEY, JSON.stringify(list));
}

function ensureProfileExists(name) {
  const profiles = loadProfiles();
  if (!profiles.includes(name)) {
    profiles.push(name);
    saveProfiles(profiles);
  }
  localStorage.setItem("dwr_active_profile", name);
}

// ----------------- State -----------------
function defaultState() {
  return {
    settings: {
      modes: { debt: true, invest: true },
      strategy: "hybrid",
      extraPayment: 0,
      safetyFloor: 3000,
      efGoal: 0,
      budgets: { groceries: 1100, gas: 300, other: 0 },
      calendar: { startingBalance: 0, startDate: todayISO(), days: 30 },
    },
    income: [{ id: crypto.randomUUID(), name: "Income", amount: 0, payDates: [], avgMode: "annualized" }],
    bills: [{ id: crypto.randomUUID(), name: "Bill", amount: 0, dueDay: 1 }],
    debts: [{ id: crypto.randomUUID(), name: "Debt", balance: 0, apr: 0, minPay: 0, dueDay: 1, type: "card" }],
    assets: [{ id: crypto.randomUUID(), name: "Savings", balance: 0, monthly: 0, type: "savings" }],
    freed: [],
    scoreboard: Array.from({ length: 12 }).map((_, i) => ({
      week: i + 1,
      noNewDebt: false,
      groceriesOnTarget: false,
      extraPayment: false,
    })),
  };
}

function seedWithStarter(s) {
  const d = defaultState();
  s.settings ??= d.settings;
  s.settings.modes ??= { debt: true, invest: true };
  s.settings.budgets ??= d.settings.budgets;
  s.settings.calendar ??= d.settings.calendar;
  s.income ??= [];
  s.bills ??= [];
  s.debts ??= [];
  s.assets ??= [];
  s.freed ??= [];
  s.scoreboard ??= d.scoreboard;

  s.income = s.income.map((inc) => {
    inc.id ??= crypto.randomUUID();
    inc.payDates ??= [];
    inc.avgMode ??= "annualized";
    return inc;
  });

  return s;
}

function loadState() {
  ensureProfileExists(activeProfile);
  const raw = localStorage.getItem(keyFor(activeProfile));
  if (!raw) return seedWithStarter(defaultState());
  try {
    return seedWithStarter(JSON.parse(raw));
  } catch {
    return seedWithStarter(defaultState());
  }
}

function saveState() {
  localStorage.setItem(keyFor(activeProfile), JSON.stringify(state));
}

let state = loadState();

// ----------------- Totals -----------------
function sumBills(bills) {
  return bills.reduce((a, b) => a + Number(b.amount || 0), 0);
}
function sumDebtMinimums(debts) {
  return debts.reduce((a, d) => a + Number(d.minPay || 0), 0);
}
function sumDebts(debts) {
  return debts.reduce((a, d) => a + Number(d.balance || 0), 0);
}
function sumAssets(assets) {
  return assets.reduce((a, x) => a + Number(x.balance || 0), 0);
}
function sumAssetContribs(assets) {
  return assets.reduce((a, x) => a + Number(x.monthly || 0), 0);
}

function monthlyAverageIncome(income) {
  const now = startOfDay(new Date());
  const oneYear = addDays(now, 365);

  let annual = 0;
  for (const inc of income) {
    const amt = Number(inc.amount || 0);
    if (!amt) continue;

    const dates = (inc.payDates || []).map((d) => startOfDay(new Date(d))).filter((d) => !isNaN(d));
    if (!dates.length) continue;

    const count = dates.filter((d) => d >= now && d <= oneYear).length;
    annual += amt * count;
  }
  return annual / 12;
}

// ----------------- Key fix: lightweight recompute -----------------
let __recalcTimer = null;
function scheduleRecalc() {
  if (__recalcTimer) clearTimeout(__recalcTimer);
  __recalcTimer = setTimeout(() => {
    // Only recompute / redraw computed views. DO NOT rebuild inputs lists.
    renderLadder();
    build12MonthPreview();
    renderDashboard();
    renderHeatmap();
    renderNetWorthTimeline();
    applyModes();
  }, 80);
}

// ----------------- UI helpers -----------------
function mkItemShell(title) {
  const wrap = document.createElement("div");
  wrap.className = "item";
  const top = document.createElement("div");
  top.className = "item-top";
  const t = document.createElement("div");
  t.className = "item-title";
  t.textContent = title;
  const actions = document.createElement("div");
  actions.className = "item-actions";
  top.appendChild(t);
  top.appendChild(actions);
  wrap.appendChild(top);
  return { wrap, actions, titleEl: t };
}

function mkBtn(label, onClick) {
  const b = document.createElement("button");
  b.className = "iconbtn";
  b.textContent = label;
  b.onclick = onClick;
  return b;
}

function mkField(label, input) {
  const f = document.createElement("div");
  f.className = "field";
  const l = document.createElement("label");
  l.textContent = label;
  f.appendChild(l);
  f.appendChild(input);
  return f;
}

function numInput(value, onInput) {
  const i = document.createElement("input");
  i.type = "number";
  i.step = "0.01";
  i.min = "0";
  i.value = String(value ?? 0);
  i.oninput = () => onInput(Number(i.value || 0));
  return i;
}

function textInput(value, onInput) {
  const i = document.createElement("input");
  i.type = "text";
  i.value = value ?? "";
  i.oninput = () => onInput(i.value);
  return i;
}

function dayInput(value, onInput) {
  const i = document.createElement("input");
  i.type = "number";
  i.step = "1";
  i.min = "1";
  i.max = "28";
  i.value = String(value ?? 1);
  i.oninput = () => onInput(clamp(Number(i.value || 1), 1, 28));
  return i;
}

function selectInput(value, options, onInput) {
  const s = document.createElement("select");
  for (const opt of options) {
    const o = document.createElement("option");
    o.value = opt.value;
    o.textContent = opt.label;
    if (opt.value === value) o.selected = true;
    s.appendChild(o);
  }
  s.onchange = () => onInput(s.value);
  return s;
}

// ----------------- Render lists -----------------
function renderIncome() {
  const root = $("#incomeList");
  root.innerHTML = "";
  state.income.forEach((inc) => {
    const shell = mkItemShell(inc.name || "Income");
    shell.actions.appendChild(
      mkBtn("Delete", () => {
        state.income = state.income.filter((x) => x.id !== inc.id);
        saveState();
        renderAll(); // full render OK (structural change)
      })
    );

    const grid = document.createElement("div");
    grid.className = "grid three";

    const name = textInput(inc.name, (v) => {
      inc.name = v;
      shell.titleEl.textContent = v || "Income";
      saveState();
      scheduleRecalc();
    });

    const amt = numInput(inc.amount, (v) => {
      inc.amount = v;
      saveState();
      scheduleRecalc();
    });

    const avgMode = selectInput(
      inc.avgMode || "annualized",
      [{ value: "annualized", label: "Avg monthly from next 365d (recommended)" }],
      (v) => {
        inc.avgMode = v;
        saveState();
        scheduleRecalc();
      }
    );

    const ta = document.createElement("textarea");
    ta.rows = 4;
    ta.placeholder = "Pay dates (YYYY-MM-DD), one per line\nExample:\n2026-03-11\n2026-03-25\n2026-04-08";
    ta.value = (inc.payDates || []).join("\n");
    ta.oninput = () => {
      inc.payDates = ta.value.split("\n").map((s) => toISODateLoose(s.trim())).filter(Boolean);
      inc.payDates = uniqSortDates(inc.payDates);
      saveState();
      scheduleRecalc();
    };

    grid.appendChild(mkField("Name", name));
    grid.appendChild(mkField("Paycheck Amount", amt));
    grid.appendChild(mkField("Income Avg Method", avgMode));

    const grid2 = document.createElement("div");
    grid2.className = "grid two";
    grid2.appendChild(mkField("Pay Dates List", ta));

    shell.wrap.appendChild(grid);
    shell.wrap.appendChild(grid2);
    root.appendChild(shell.wrap);
  });
}

function renderBills() {
  const root = $("#billList");
  root.innerHTML = "";
  state.bills.forEach((b) => {
    const shell = mkItemShell(b.name || "Bill");
    shell.actions.appendChild(
      mkBtn("Delete", () => {
        state.bills = state.bills.filter((x) => x.id !== b.id);
        saveState();
        renderAll();
      })
    );

    const grid = document.createElement("div");
    grid.className = "grid three";
    grid.appendChild(
      mkField(
        "Name",
        textInput(b.name, (v) => {
          b.name = v;
          shell.titleEl.textContent = v || "Bill";
          saveState();
          scheduleRecalc();
        })
      )
    );
    grid.appendChild(
      mkField(
        "Amount (monthly)",
        numInput(b.amount, (v) => {
          b.amount = v;
          saveState();
          scheduleRecalc();
        })
      )
    );
    grid.appendChild(
      mkField(
        "Due Day (1–28)",
        dayInput(b.dueDay, (v) => {
          b.dueDay = v;
          saveState();
          scheduleRecalc();
        })
      )
    );

    shell.wrap.appendChild(grid);
    root.appendChild(shell.wrap);
  });
}

function renderDebts() {
  const root = $("#debtList");
  root.innerHTML = "";
  state.debts.forEach((d) => {
    const shell = mkItemShell(d.name || "Debt");
    shell.actions.appendChild(
      mkBtn("Delete", () => {
        state.debts = state.debts.filter((x) => x.id !== d.id);
        saveState();
        renderAll();
      })
    );

    const grid = document.createElement("div");
    grid.className = "grid three";
    grid.appendChild(
      mkField(
        "Name",
        textInput(d.name, (v) => {
          d.name = v;
          shell.titleEl.textContent = v || "Debt";
          saveState();
          scheduleRecalc();
        })
      )
    );
    grid.appendChild(
      mkField(
        "Balance",
        numInput(d.balance, (v) => {
          d.balance = v;
          saveState();
          scheduleRecalc();
        })
      )
    );
    grid.appendChild(
      mkField(
        "APR %",
        numInput(d.apr, (v) => {
          d.apr = v;
          saveState();
          scheduleRecalc();
        })
      )
    );

    const grid2 = document.createElement("div");
    grid2.className = "grid three";
    grid2.appendChild(
      mkField(
        "Minimum / month",
        numInput(d.minPay, (v) => {
          d.minPay = v;
          saveState();
          scheduleRecalc();
        })
      )
    );
    grid2.appendChild(
      mkField(
        "Due Day (1–28)",
        dayInput(d.dueDay, (v) => {
          d.dueDay = v;
          saveState();
          scheduleRecalc();
        })
      )
    );
    grid2.appendChild(
      mkField(
        "Type",
        selectInput(
          d.type || "card",
          [
            { value: "card", label: "Credit Card" },
            { value: "loan", label: "Loan" },
            { value: "bnpl", label: "BNPL" },
          ],
          (v) => {
            d.type = v;
            saveState();
            scheduleRecalc();
          }
        )
      )
    );

    shell.wrap.appendChild(grid);
    shell.wrap.appendChild(grid2);
    root.appendChild(shell.wrap);
  });
}

function renderAssets() {
  const root = $("#assetList");
  root.innerHTML = "";
  state.assets.forEach((a) => {
    const shell = mkItemShell(a.name || "Asset");
    shell.actions.appendChild(
      mkBtn("Delete", () => {
        state.assets = state.assets.filter((x) => x.id !== a.id);
        saveState();
        renderAll();
      })
    );

    const grid = document.createElement("div");
    grid.className = "grid three";
    grid.appendChild(
      mkField(
        "Name",
        textInput(a.name, (v) => {
          a.name = v;
          shell.titleEl.textContent = v || "Asset";
          saveState();
          scheduleRecalc();
        })
      )
    );
    grid.appendChild(
      mkField(
        "Current Balance",
        numInput(a.balance, (v) => {
          a.balance = v;
          saveState();
          scheduleRecalc();
        })
      )
    );
    grid.appendChild(
      mkField(
        "Monthly Contribution",
        numInput(a.monthly, (v) => {
          a.monthly = v;
          saveState();
          scheduleRecalc();
        })
      )
    );

    const grid2 = document.createElement("div");
    grid2.className = "grid two";
    grid2.appendChild(
      mkField(
        "Type",
        selectInput(
          a.type || "savings",
          [
            { value: "savings", label: "Savings" },
            { value: "investment", label: "Investment" },
            { value: "retirement", label: "Retirement" },
            { value: "other", label: "Other" },
          ],
          (v) => {
            a.type = v;
            saveState();
            scheduleRecalc();
          }
        )
      )
    );

    shell.wrap.appendChild(grid);
    shell.wrap.appendChild(grid2);
    root.appendChild(shell.wrap);
  });
}

function renderFreed() {
  const root = $("#freedList");
  root.innerHTML = "";
  state.freed.forEach((f) => {
    const shell = mkItemShell(f.name || "Freed Payment");
    shell.actions.appendChild(
      mkBtn("Delete", () => {
        state.freed = state.freed.filter((x) => x.id !== f.id);
        saveState();
        renderAll();
      })
    );
    const grid = document.createElement("div");
    grid.className = "grid three";
    grid.appendChild(
      mkField(
        "Name",
        textInput(f.name, (v) => {
          f.name = v;
          shell.titleEl.textContent = v || "Freed Payment";
          saveState();
          // No need to recalc dashboard every keystroke here
        })
      )
    );
    grid.appendChild(
      mkField(
        "Amount / month",
        numInput(f.amount, (v) => {
          f.amount = v;
          saveState();
        })
      )
    );
    grid.appendChild(
      mkField(
        "Month (e.g., 2026-03)",
        textInput(f.month, (v) => {
          f.month = v;
          saveState();
        })
      )
    );
    shell.wrap.appendChild(grid);
    root.appendChild(shell.wrap);
  });
}

function renderScoreboard() {
  const root = $("#scoreboard");
  root.innerHTML = "";
  state.scoreboard.forEach((w) => {
    const row = document.createElement("div");
    row.className = "week";

    const wk = document.createElement("div");
    wk.className = "item-title";
    wk.textContent = `Week ${w.week}`;

    const mkChk = (label, key) => {
      const c = document.createElement("label");
      c.className = "chk";
      const i = document.createElement("input");
      i.type = "checkbox";
      i.checked = !!w[key];
      i.onchange = () => {
        w[key] = i.checked;
        saveState();
      };
      c.appendChild(i);
      c.appendChild(document.createTextNode(label));
      return c;
    };

    row.appendChild(wk);
    row.appendChild(mkChk("No New Debt", "noNewDebt"));
    row.appendChild(mkChk("Groceries On Target", "groceriesOnTarget"));
    row.appendChild(mkChk("Extra Payment Made", "extraPayment"));
    root.appendChild(row);
  });
}

// ----------------- Modes -----------------
function applyModes() {
  const debtOn = !!state.settings.modes.debt;
  const investOn = !!state.settings.modes.invest;

  document.querySelectorAll("[data-debt]").forEach((el) => {
    el.style.display = debtOn ? "" : "none";
  });
  document.querySelectorAll("[data-invest]").forEach((el) => {
    el.style.display = investOn ? "" : "none";
  });

  document.querySelectorAll('.tab[data-tab="strategy"]').forEach((btn) => {
    btn.style.display = debtOn ? "" : "none";
  });

  const activeTab = document.querySelector(".tab.active");
  if (!debtOn && activeTab?.dataset?.tab === "strategy") {
    document.querySelector('.tab[data-tab="dashboard"]').click();
  }
}

function bindModeToggles() {
  const debtToggle = $("#toggleDebtMode");
  const investToggle = $("#toggleInvestMode");

  debtToggle.checked = !!state.settings.modes.debt;
  investToggle.checked = !!state.settings.modes.invest;

  debtToggle.onchange = () => {
    state.settings.modes.debt = debtToggle.checked;
    saveState();
    applyModes();
    scheduleRecalc();
    // If turning debt on/off changes which lists exist, rebuild once:
    renderAll();
  };

  investToggle.onchange = () => {
    state.settings.modes.invest = investToggle.checked;
    saveState();
    applyModes();
    scheduleRecalc();
    renderAll();
  };
}

// ----------------- Strategy / Ladder -----------------
function sortedDebts() {
  const debts = [...state.debts].filter((d) => Number(d.balance || 0) > 0);
  const strat = state.settings.strategy || "hybrid";

  if (strat === "snowball") {
    debts.sort((a, b) => Number(a.balance) - Number(b.balance));
    return debts;
  }
  if (strat === "avalanche") {
    debts.sort((a, b) => Number(b.apr || 0) - Number(a.apr || 0) || Number(a.balance) - Number(b.balance));
    return debts;
  }

  const smallFirst = debts
    .filter((d) => d.type === "bnpl" || Number(d.balance) <= 1000)
    .sort((a, b) => Number(a.balance) - Number(b.balance));
  const rest = debts
    .filter((d) => !(d.type === "bnpl" || Number(d.balance) <= 1000))
    .sort((a, b) => Number(b.apr || 0) - Number(a.apr || 0) || Number(a.balance) - Number(b.balance));
  return [...smallFirst, ...rest];
}

function renderLadder() {
  const root = $("#ladder");
  if (!root) return;
  root.innerHTML = "";
  const debts = sortedDebts();
  if (!debts.length) {
    root.innerHTML = `<div class="meta">Add debts to see the ladder.</div>`;
    return;
  }
  debts.forEach((d, idx) => {
    const row = document.createElement("div");
    row.className = "r";
    row.innerHTML = `
      <div>
        <div><strong>${idx + 1}. ${d.name}</strong></div>
        <div class="meta">${(d.type || "").toUpperCase()} • APR ${Number(d.apr || 0).toFixed(2)}% • Min ${money(
      d.minPay || 0
    )} • Due day ${d.dueDay}</div>
      </div>
      <div class="badge">${money(d.balance || 0)}</div>
    `;
    root.appendChild(row);
  });
}

function build12MonthPreview() {
  const out = $("#planPreview");
  if (!out) return;
  out.innerHTML = "";

  const debtOn = !!state.settings.modes.debt;
  if (!debtOn) {
    out.innerHTML = `<div class="meta">Debt Mode is off.</div>`;
    return;
  }

  const income = monthlyAverageIncome(state.income);
  const fixed = sumBills(state.bills);
  const mins = sumDebtMinimums(state.debts);
  const vars =
    Number(state.settings.budgets.groceries || 0) +
    Number(state.settings.budgets.gas || 0) +
    Number(state.settings.budgets.other || 0);
  const attack = Math.max(0, income - (fixed + mins + vars)) + Number(state.settings.extraPayment || 0);

  const debts = sortedDebts().map((d) => ({ ...d }));
  let total = sumDebts(debts);

  const start = new Date();
  for (let m = 0; m < 12; m++) {
    const monthDate = new Date(start.getFullYear(), start.getMonth() + m, 1);
    const label = monthDate.toLocaleDateString(undefined, { month: "long", year: "numeric" });

    for (const d of debts) {
      const bal = Number(d.balance || 0);
      if (bal <= 0) continue;
      const pay = Math.min(bal, Number(d.minPay || 0));
      d.balance = bal - pay;
      total -= pay;
    }

    const target = debts.find((x) => Number(x.balance || 0) > 0);
    if (target) {
      const pay2 = Math.min(Number(target.balance || 0), attack);
      target.balance = Number(target.balance || 0) - pay2;
      total -= pay2;
    }

    const card = document.createElement("div");
    card.className = "m";
    card.innerHTML = `
      <div class="item-title">${label}</div>
      <div class="meta">Attack used: <strong>${money(attack)}</strong></div>
      <div class="meta">Projected remaining debt: <strong>${money(Math.max(0, total))}</strong></div>
    `;
    out.appendChild(card);
  }
}

// ----------------- Calendar Simulation -----------------
function buildMonthlyEventsWindow(startDateISO, days) {
  const start = startOfDay(new Date(startDateISO));
  const end = addDays(start, Number(days || 30));
  const events = [];

  for (const inc of state.income) {
    const amt = Number(inc.amount || 0);
    if (!amt) continue;
    const dates = (inc.payDates || []).map((d) => startOfDay(new Date(d))).filter((d) => !isNaN(d));

    for (const d of dates) {
      if (d >= start && d <= end) {
        events.push({ date: d, label: `Income: ${inc.name}`, amount: +amt });
      }
    }
  }

  for (const b of state.bills) {
    const amt = Number(b.amount || 0);
    if (!amt) continue;
    let d = nextMonthlyDate(b.dueDay || 1, start);
    while (d <= end) {
      events.push({ date: d, label: `Bill: ${b.name}`, amount: -amt });
      d = new Date(d.getFullYear(), d.getMonth() + 1, d.getDate());
    }
  }

  if (state.settings.modes.debt) {
    for (const d0 of state.debts) {
      const minPay = Number(d0.minPay || 0);
      if (!minPay) continue;
      let d = nextMonthlyDate(d0.dueDay || 1, start);
      while (d <= end) {
        events.push({ date: d, label: `Min Pay: ${d0.name}`, amount: -minPay });
        d = new Date(d.getFullYear(), d.getMonth() + 1, d.getDate());
      }
    }
  }

  events.sort((a, b) => a.date - b.date);
  return { start, end, events };
}

function simulateCashflow() {
  const startISO = $("#startDate").value || state.settings.calendar.startDate || todayISO();
  const days = Number($("#daysToSim").value || state.settings.calendar.days || 30);
  const startingBal = Number($("#startingBalance").value || state.settings.calendar.startingBalance || 0);
  const floor = Number(state.settings.safetyFloor || 0);

  const { start, events } = buildMonthlyEventsWindow(startISO, days);

  const map = new Map();
  for (const e of events) {
    const k = e.date.toISOString().slice(0, 10);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(e);
  }

  const list = $("#calendarList");
  list.innerHTML = "";

  const warnings = [];
  let bal = startingBal;

  for (let i = 0; i <= days; i++) {
    const d = addDays(start, i);
    const k = d.toISOString().slice(0, 10);
    const items = map.get(k) || [];

    for (const it of items) bal += it.amount;

    const node = document.createElement("div");
    node.className = "cal-day";

    const dateCell = document.createElement("div");
    dateCell.className = "cal-date";
    dateCell.textContent = fmtDate(d);

    const itemsCell = document.createElement("div");
    itemsCell.className = "cal-items";

    const inflows = items.filter((x) => x.amount > 0);
    const outflows = items.filter((x) => x.amount < 0);

    const renderGroup = (title, group) => {
      if (!group.length) return "";
      const lines = group
        .map((x) => {
          const sign = x.amount >= 0 ? "+" : "−";
          return `<div><strong>${sign}${money(Math.abs(x.amount))}</strong> • ${x.label}</div>`;
        })
        .join("");
      return `
        <div style="margin-bottom:6px;">
          <span class="badge">${title}</span>
          <div class="cal-items" style="margin-top:6px;">${lines}</div>
        </div>
      `;
    };

    const html = renderGroup("INCOME", inflows) + renderGroup("BILLS/PAYS", outflows);
    itemsCell.innerHTML = html || "—";

    const balCell = document.createElement("div");
    balCell.className = "cal-bal";
    const below = bal < floor;
    balCell.innerHTML = `<div class="${below ? "dangerText" : ""}">${money(bal)}</div>
      <div class="meta">Floor: ${money(floor)}</div>`;

    if (below) warnings.push(`Balance drops below safety floor on ${fmtDate(d)} (est. ${money(bal)}).`);

    node.appendChild(dateCell);
    node.appendChild(itemsCell);
    node.appendChild(balCell);
    list.appendChild(node);
  }

  const wroot = $("#warnings");
  wroot.innerHTML = "";
  if (!warnings.length) {
    wroot.innerHTML = `<div class="meta ok">No safety-floor violations in this window.</div>`;
  } else {
    warnings.slice(0, 8).forEach((msg) => {
      const w = document.createElement("div");
      w.className = "w";
      w.textContent = msg;
      wroot.appendChild(w);
    });
  }

  state.settings.calendar.startDate = startISO;
  state.settings.calendar.days = days;
  state.settings.calendar.startingBalance = startingBal;
  saveState();
}

// ----------------- Dashboard + Charts -----------------
let thermoChart = null;
let netWorthChart = null;

function renderDashboard() {
  const debtOn = !!state.settings.modes.debt;
  const investOn = !!state.settings.modes.invest;

  const income = monthlyAverageIncome(state.income);
  const fixed = sumBills(state.bills);
  const mins = debtOn ? sumDebtMinimums(state.debts) : 0;
  const vars =
    Number(state.settings.budgets.groceries || 0) +
    Number(state.settings.budgets.gas || 0) +
    Number(state.settings.budgets.other || 0);

  const baseAttack = Math.max(0, income - (fixed + mins + vars));
  const extra = Number(state.settings.extraPayment || 0);
  const attackTotal = baseAttack + extra;

  const debtTotal = debtOn ? sumDebts(state.debts) : 0;
  const assetsTotal = investOn ? sumAssets(state.assets) : 0;
  const netWorth = assetsTotal - debtTotal;

  $("#mIncome").textContent = money(income);
  $("#mFixed").textContent = money(fixed);
  const minsEl = $("#mMins");
  if (minsEl) minsEl.textContent = money(mins);
  $("#mVars").textContent = money(vars);
  $("#mAttack").textContent = money(attackTotal);

  const nwEl = $("#mNetWorth");
  if (nwEl) nwEl.textContent = money(netWorth);
  const nwMeta = $("#mNetWorthMeta");
  if (nwMeta) nwMeta.textContent = `${money(assetsTotal)} assets − ${money(debtTotal)} debts`;

  const pDebt = $("#pDebt");
  if (pDebt) pDebt.textContent = money(debtTotal);
  $("#pAttack").textContent = money(attackTotal);

  const pSaveInv = $("#pSaveInv");
  if (pSaveInv) pSaveInv.textContent = money(investOn ? sumAssetContribs(state.assets) : 0);
  $("#pEFGoal").textContent = money(state.settings.efGoal || 0);

  const pMonths = $("#pMonths");
  const pDate = $("#pDate");
  if (debtOn && attackTotal > 0 && debtTotal > 0) {
    const months = Math.ceil(debtTotal / attackTotal);
    pMonths.textContent = String(months);
    const d = new Date();
    d.setMonth(d.getMonth() + months);
    pDate.textContent = d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  } else {
    if (pMonths) pMonths.textContent = "—";
    if (pDate) pDate.textContent = "—";
  }

  const ctx = $("#chartThermo");
  if (ctx && debtOn && window.Chart) {
    const data = {
      labels: ["Debts", "Assets"],
      datasets: [{ label: "Amount", data: [debtTotal, assetsTotal] }],
    };
    if (thermoChart) thermoChart.destroy();
    thermoChart = new Chart(ctx, {
      type: "bar",
      data,
      options: {
        responsive: true,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (c) => money(c.raw) } },
        },
        scales: { y: { ticks: { callback: (v) => money(v) } } },
      },
    });
    $("#thermoMeta").textContent = `Shrink debt and grow assets to move net worth up.`;
  }
}

// ----------------- Heatmap -----------------
function renderHeatmap() {
  const el = $("#heatmap");
  if (!el) return;
  if (!state.settings.modes.debt) {
    el.innerHTML = "";
    return;
  }
  if (!window.CalHeatmap) {
    el.innerHTML = `<div class="meta">Heatmap library not loaded.</div>`;
    return;
  }

  el.innerHTML = "";

  const start = startOfDay(new Date());
  const end = addDays(start, 90);
  const counts = new Map();

  function addCount(date) {
    const k = date.toISOString().slice(0, 10);
    counts.set(k, (counts.get(k) || 0) + 1);
  }

  const schedMonthly = (dueDay) => {
    let d = nextMonthlyDate(dueDay, start);
    while (d <= end) {
      addCount(d);
      d = new Date(d.getFullYear(), d.getMonth() + 1, d.getDate());
    }
  };

  state.bills.forEach((b) => schedMonthly(b.dueDay || 1));
  state.debts.forEach((d) => schedMonthly(d.dueDay || 1));

  const ds = {};
  for (const [k, v] of counts.entries()) {
    const dt = new Date(k);
    ds[Math.floor(dt.getTime() / 1000)] = v;
  }

  const cal = new CalHeatmap();
  cal.paint({
    itemSelector: "#heatmap",
    date: { start },
    range: 3,
    domain: { type: "month" },
    subDomain: { type: "day" },
    data: { source: ds, type: "json" },
    scale: {
      color: {
        type: "threshold",
        range: ["#1e2a3e", "#245b63", "#2a8b86", "#5dd6c0"],
        domain: [1, 2, 3, 4],
      },
    },
  });
}

// ----------------- Net worth timeline -----------------
function dailyRate(aprPct) {
  return Number(aprPct || 0) / 100 / 365;
}
function addMonths(date, n) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + n);
  return d;
}
function endOfMonth(date) {
  const d = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  d.setHours(0, 0, 0, 0);
  return d;
}

function renderNetWorthTimeline() {
  const ctx = $("#chartNetWorth");
  if (!ctx) return;
  if (!state.settings.modes.invest) {
    if (netWorthChart) {
      netWorthChart.destroy();
      netWorthChart = null;
    }
    return;
  }
  if (!window.Chart) return;

  const debtOn = !!state.settings.modes.debt;
  const investOn = !!state.settings.modes.invest;

  const income = monthlyAverageIncome(state.income);
  const fixed = sumBills(state.bills);
  const mins = debtOn ? sumDebtMinimums(state.debts) : 0;
  const vars =
    Number(state.settings.budgets.groceries || 0) +
    Number(state.settings.budgets.gas || 0) +
    Number(state.settings.budgets.other || 0);
  const attack = Math.max(0, income - (fixed + mins + vars)) + Number(state.settings.extraPayment || 0);

  const assetsStart = investOn ? sumAssets(state.assets) : 0;
  const assetsMonthly = investOn ? sumAssetContribs(state.assets) : 0;

  let working = (debtOn ? state.debts : [])
    .filter((d) => Number(d.balance || 0) > 0)
    .map((d) => ({
      ...d,
      balance: Number(d.balance || 0),
      apr: Number(d.apr || 0),
      minPay: Number(d.minPay || 0),
      type: d.type || "card",
    }));

  const labels = [];
  const series = [];
  const start = new Date();

  for (let m = 0; m < 12; m++) {
    const monthDate = new Date(start.getFullYear(), start.getMonth() + m, 1);
    labels.push(monthDate.toLocaleDateString(undefined, { month: "short" }));

    const eom = endOfMonth(monthDate);
    const daysInMonth = Math.round((eom - monthDate) / (1000 * 60 * 60 * 24)) + 1;

    for (const d of working) {
      if (d.balance <= 0) continue;
      const r = dailyRate(d.apr);
      const interest = d.balance * (Math.pow(1 + r, daysInMonth) - 1);
      d.balance += interest;
    }

    for (const d of working) {
      if (d.balance <= 0) continue;
      const pay = Math.min(d.balance, d.minPay);
      d.balance -= pay;
    }

    let remaining = attack;
    while (remaining > 0) {
      const t = working.find((x) => x.balance > 0);
      if (!t) break;
      const pay = Math.min(t.balance, remaining);
      t.balance -= pay;
      remaining -= pay;
    }

    const debtNow = working.reduce((a, d) => a + d.balance, 0);
    const assetsNow = assetsStart + assetsMonthly * (m + 1);
    series.push(assetsNow - debtNow);
  }

  if (netWorthChart) netWorthChart.destroy();
  netWorthChart = new Chart(ctx, {
    type: "line",
    data: { labels, datasets: [{ label: "Net Worth", data: series }] },
    options: {
      responsive: true,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => money(c.raw) } } },
      scales: { y: { ticks: { callback: (v) => money(v) } } },
    },
  });
}

// ----------------- Interest payoff simulation -----------------
function simPayoffWithInterest({ debts, monthlyAttack, strategy, startDate = new Date(), maxMonths = 180 }) {
  const working = debts
    .filter((d) => Number(d.balance || 0) > 0)
    .map((d) => ({
      id: d.id,
      name: d.name,
      type: d.type || "card",
      apr: Number(d.apr || 0),
      minPay: Number(d.minPay || 0),
      balance: Number(d.balance || 0),
      payoffMonth: null,
      interestPaid: 0,
    }));

  let order = [...working];
  if (strategy === "snowball") order.sort((a, b) => a.balance - b.balance);
  else if (strategy === "avalanche") order.sort((a, b) => b.apr - a.apr || a.balance - b.balance);
  else {
    const smallFirst = order.filter((x) => x.type === "bnpl" || x.balance <= 1000).sort((a, b) => a.balance - b.balance);
    const rest = order
      .filter((x) => !(x.type === "bnpl" || x.balance <= 1000))
      .sort((a, b) => b.apr - a.apr || a.balance - b.balance);
    order = [...smallFirst, ...rest];
  }

  const orderIds = order.map((x) => x.id);
  const byId = new Map(working.map((x) => [x.id, x]));

  let totalInterest = 0;
  let month = 0;
  let cur = new Date(startDate.getFullYear(), startDate.getMonth(), 1);

  while (month < maxMonths) {
    const eom = endOfMonth(cur);
    const daysInMonth = Math.round((eom - cur) / (1000 * 60 * 60 * 24)) + 1;

    for (const d of working) {
      if (d.balance <= 0) continue;
      const r = dailyRate(d.apr);
      const interest = d.balance * (Math.pow(1 + r, daysInMonth) - 1);
      d.balance += interest;
      d.interestPaid += interest;
      totalInterest += interest;
    }

    for (const d of working) {
      if (d.balance <= 0) continue;
      const pay = Math.min(d.balance, d.minPay);
      d.balance -= pay;
    }

    let remaining = monthlyAttack;
    while (remaining > 0) {
      const targetId = orderIds.find((id) => (byId.get(id)?.balance || 0) > 0);
      if (!targetId) break;
      const t = byId.get(targetId);
      const pay = Math.min(t.balance, remaining);
      t.balance -= pay;
      remaining -= pay;
    }

    for (const d of working) {
      if (d.payoffMonth === null && d.balance <= 0.01) {
        d.balance = 0;
        d.payoffMonth = month;
      }
    }

    if (!working.some((d) => d.balance > 0)) {
      return {
        monthsToZero: month + 1,
        debtFreeDate: addMonths(new Date(startDate.getFullYear(), startDate.getMonth(), 1), month + 1),
        totalInterest,
        results: working.slice().sort((a, b) => (a.payoffMonth ?? 999) - (b.payoffMonth ?? 999)),
      };
    }

    month += 1;
    cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
  }

  return { monthsToZero: null, debtFreeDate: null, totalInterest, results: working };
}

function renderSimulation() {
  const debtOn = !!state.settings.modes.debt;
  if (!debtOn) return;

  const income = monthlyAverageIncome(state.income);
  const fixed = sumBills(state.bills);
  const mins = sumDebtMinimums(state.debts);
  const vars =
    Number(state.settings.budgets.groceries || 0) +
    Number(state.settings.budgets.gas || 0) +
    Number(state.settings.budgets.other || 0);

  const baseAttack = Math.max(0, income - (fixed + mins + vars));
  const monthlyAttack = baseAttack + Number(state.settings.extraPayment || 0);

  const sim = simPayoffWithInterest({
    debts: state.debts,
    monthlyAttack,
    strategy: state.settings.strategy || "hybrid",
    startDate: new Date(),
  });

  const sum = $("#simSummary");
  const table = $("#simTable");
  if (!sum || !table) return;
  sum.innerHTML = "";
  table.innerHTML = "";

  const debtTotal = sumDebts(state.debts);

  sum.innerHTML = `
    <div class="row"><div class="label">Starting Debt</div><div class="value">${money(debtTotal)}</div></div>
    <div class="row"><div class="label">Monthly Attack Used</div><div class="value">${money(monthlyAttack)}</div></div>
    <div class="row"><div class="label">Total Interest (est.)</div><div class="value">${money(sim.totalInterest)}</div></div>
    <div class="row"><div class="label">Debt-Free Date (est.)</div><div class="value">${
      sim.debtFreeDate ? sim.debtFreeDate.toLocaleDateString(undefined, { month: "long", year: "numeric" }) : "—"
    }</div></div>
  `;

  sim.results.forEach((r) => {
    const monthLabel =
      r.payoffMonth === null ? "—" : addMonths(new Date(), r.payoffMonth).toLocaleDateString(undefined, { month: "short", year: "numeric" });
    const node = document.createElement("div");
    node.className = "item";
    node.innerHTML = `
      <div class="item-top">
        <div class="item-title">${r.name}</div>
        <div class="badge">Payoff: ${monthLabel}</div>
      </div>
      <div class="meta">Interest paid (est): <strong>${money(r.interestPaid)}</strong> • APR ${r.apr.toFixed(
        2
      )}% • Min ${money(r.minPay)}</div>
    `;
    table.appendChild(node);
  });
}

// ----------------- PDF -----------------
async function generatePDF() {
  if (!window.jspdf) return alert("PDF library not loaded.");
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: "letter" });

  const debtOn = !!state.settings.modes.debt;
  const investOn = !!state.settings.modes.invest;

  const income = monthlyAverageIncome(state.income);
  const fixed = sumBills(state.bills);
  const mins = debtOn ? sumDebtMinimums(state.debts) : 0;
  const vars =
    Number(state.settings.budgets.groceries || 0) +
    Number(state.settings.budgets.gas || 0) +
    Number(state.settings.budgets.other || 0);
  const attack = Math.max(0, income - (fixed + mins + vars)) + Number(state.settings.extraPayment || 0);
  const debtTotal = debtOn ? sumDebts(state.debts) : 0;
  const assetsTotal = investOn ? sumAssets(state.assets) : 0;

  let y = 48;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("Moore Budget Less Problems — Printable Board", 48, y);
  y += 22;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text(`Generated: ${new Date().toLocaleString()}`, 48, y);
  y += 18;

  doc.setFontSize(12);
  doc.text(`Monthly Income: ${money(income)}   Fixed: ${money(fixed)}   Minimums: ${money(mins)}   Variables: ${money(vars)}`, 48, y);
  y += 16;
  doc.text(
    `Attack Power: ${money(attack)}   Total Debt: ${money(debtTotal)}   Assets: ${money(assetsTotal)}   Net Worth: ${money(
      assetsTotal - debtTotal
    )}`,
    48,
    y
  );
  y += 22;

  doc.setFont("helvetica", "bold");
  doc.text("12-Month Elimination Board", 48, y);
  y += 14;

  const start = new Date();
  const boxW = 170,
    boxH = 68,
    gap = 10;
  let x = 48,
    rowY = y + 10;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);

  for (let i = 0; i < 12; i++) {
    const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
    const label = d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    doc.rect(x, rowY, boxW, boxH);
    doc.text(label, x + 8, rowY + 16);
    doc.text("Start: ____________", x + 8, rowY + 34);
    doc.text("End:   ____________", x + 8, rowY + 50);

    x += boxW + gap;
    if ((i + 1) % 3 === 0) {
      x = 48;
      rowY += boxH + gap;
    }
  }

  y = rowY + boxH + 22;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("90-Day Stabilization Scoreboard", 48, y);
  y += 14;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);

  for (let i = 0; i < 12; i++) {
    doc.text(`Week ${i + 1}:  No New Debt [ ]   Groceries On Target [ ]   Extra Payment [ ]`, 48, y);
    y += 14;
    if (y > 720) {
      doc.addPage();
      y = 48;
    }
  }

  doc.save("Moore_Budget_Less_Problems_Board.pdf");
}

// ----------------- Pay Modal -----------------
function openPayModal() {
  const modal = $("#payModal");
  const sel = $("#payModalIncome");

  sel.innerHTML = "";
  state.income.forEach((inc) => {
    const o = document.createElement("option");
    o.value = inc.id;
    o.textContent = inc.name || "Income";
    sel.appendChild(o);
  });

  $("#payStartDate").value = todayISO();
  $("#payPreview").textContent = "—";
  $("#lastPayDate").value = "";
  window.__PAY_MODAL_CLEANED__ = null;

  modal.classList.add("show");
  modal.setAttribute("aria-hidden", "false");
}

function closePayModal() {
  const modal = $("#payModal");
  modal.classList.remove("show");
  modal.setAttribute("aria-hidden", "true");
}

function getExcludedSet() {
  const raw = $("#payExclude").value || "";
  const dates = raw.split("\n").map((s) => toISODateLoose(s.trim())).filter(Boolean);
  return new Set(dates);
}

function genEveryNDays(startISO, n, count, excluded) {
  const out = [];
  let d = startOfDay(new Date(startISO));
  for (let i = 0; out.length < count && i < 5000; i++) {
    const iso = d.toISOString().slice(0, 10);
    if (!excluded.has(iso)) out.push(iso);
    d = addDays(d, n);
  }
  return out;
}

function genWeekdays(startISO, weekdays, weekInterval, count, excluded) {
  const out = [];
  let d = startOfDay(new Date(startISO));
  const wanted = new Set(weekdays.map(Number));
  const interval = Math.max(1, Number(weekInterval || 1));
  const start = startOfDay(new Date(startISO));

  for (let i = 0; out.length < count && i < 2000; i++) {
    const iso = d.toISOString().slice(0, 10);
    const dow = d.getDay();
    const daysSince = Math.floor((d - start) / (1000 * 60 * 60 * 24));
    const weekIndex = Math.floor(daysSince / 7);
    const onWeek = weekIndex % interval === 0;

    if (onWeek && wanted.has(dow) && !excluded.has(iso)) out.push(iso);
    d = addDays(d, 1);
  }
  return out;
}

function previewPayDates() {
  if (window.__PAY_MODAL_CLEANED__ && window.__PAY_MODAL_CLEANED__.length) {
    const dates = window.__PAY_MODAL_CLEANED__;
    $("#payPreview").textContent = dates.join(", ");
    return dates;
  }

  const mode = $("#payMode").value;
  const startISO = $("#payStartDate").value || todayISO();
  const count = Number($("#payCount").value || 12);
  const excluded = getExcludedSet();

  let dates = [];
  if (mode === "everyN") {
    const n = Number($("#payEveryN").value || 14);
    dates = genEveryNDays(startISO, n, count, excluded);
  } else {
    const weekInterval = Number($("#payWeekInterval").value || 1);
    const weekdays = [...document.querySelectorAll("#weekdayGrid input:checked")].map((i) => i.value);
    dates = genWeekdays(startISO, weekdays, weekInterval, count, excluded);
  }

  $("#payPreview").textContent = dates.length ? dates.join(", ") : "No dates generated (check settings).";
  return dates;
}

function generateAndAddPayDates() {
  const dates = previewPayDates();
  if (!dates.length) return;

  const incomeId = $("#payModalIncome").value;
  const inc = state.income.find((x) => x.id === incomeId);
  if (!inc) return;

  inc.payDates = uniqSortDates([...(inc.payDates || []), ...dates]);
  window.__PAY_MODAL_CLEANED__ = null;
  saveState();
  scheduleRecalc();
  closePayModal();
  // No full render needed
  // (inputs list already exists; textarea still shows older value until you reopen — acceptable)
  // If you want it to reflect instantly, uncomment next line:
  // renderAll();
}

function pasteAndCleanPayDates() {
  const text = prompt("Paste dates (any format). Examples:\n3/11/2026, 3/25/2026\n2026-04-08\nMar 22 2026");
  if (!text) return;
  const cleaned = cleanDatePaste(text);
  $("#payPreview").textContent = cleaned.length ? cleaned.join(", ") : "No valid dates found.";
  window.__PAY_MODAL_CLEANED__ = cleaned;
}

function genFromLastPay() {
  const lastISO = $("#lastPayDate").value;
  if (!lastISO) {
    alert("Enter Last Pay Date");
    return;
  }

  const n = Number($("#lastPayEveryN").value || 14);
  const count = Number($("#lastPayCount").value || 12);
  const excluded = getExcludedSet();

  const first = addDays(startOfDay(new Date(lastISO)), n).toISOString().slice(0, 10);
  const dates = genEveryNDays(first, n, count, excluded);

  window.__PAY_MODAL_CLEANED__ = dates;
  $("#payPreview").textContent = dates.join(", ");
}

// ----------------- Export / Import / Reset -----------------
function exportJSON() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `moore-budget-less-problems_${activeProfile}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importJSON(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      state = seedWithStarter(parsed);
      saveState();
      renderAll();
      alert("Imported successfully.");
    } catch {
      alert("Invalid JSON.");
    }
  };
  reader.readAsText(file);
}

function resetAll() {
  if (!confirm(`Reset all data for profile "${activeProfile}"? This cannot be undone.`)) return;
  state = seedWithStarter(defaultState());
  saveState();
  renderAll();
}

// ----------------- Inputs binding -----------------
function bindInputs() {
  $("#budgetGroceries").value = state.settings.budgets.groceries ?? 0;
  $("#budgetGas").value = state.settings.budgets.gas ?? 0;
  $("#budgetOther").value = state.settings.budgets.other ?? 0;
  $("#safetyFloor").value = state.settings.safetyFloor ?? 0;
  $("#efGoal").value = state.settings.efGoal ?? 0;

  $("#budgetGroceries").oninput = () => {
    state.settings.budgets.groceries = Number($("#budgetGroceries").value || 0);
    saveState();
    scheduleRecalc();
  };
  $("#budgetGas").oninput = () => {
    state.settings.budgets.gas = Number($("#budgetGas").value || 0);
    saveState();
    scheduleRecalc();
  };
  $("#budgetOther").oninput = () => {
    state.settings.budgets.other = Number($("#budgetOther").value || 0);
    saveState();
    scheduleRecalc();
  };
  $("#safetyFloor").oninput = () => {
    state.settings.safetyFloor = Number($("#safetyFloor").value || 0);
    saveState();
    // impacts warnings only when sim is run, but safe to recalc
    scheduleRecalc();
  };
  $("#efGoal").oninput = () => {
    state.settings.efGoal = Number($("#efGoal").value || 0);
    saveState();
    scheduleRecalc();
  };

  const strat = $("#strategySelect");
  const extra = $("#extraPayment");
  if (strat) {
    strat.value = state.settings.strategy || "hybrid";
    strat.onchange = () => {
      state.settings.strategy = strat.value;
      saveState();
      scheduleRecalc();
    };
  }
  if (extra) {
    extra.value = state.settings.extraPayment || 0;
    extra.oninput = () => {
      state.settings.extraPayment = Number(extra.value || 0);
      saveState();
      scheduleRecalc();
    };
  }

  $("#startingBalance").value = state.settings.calendar.startingBalance ?? 0;
  $("#startDate").value = state.settings.calendar.startDate ?? todayISO();
  $("#daysToSim").value = state.settings.calendar.days ?? 30;
}

// ----------------- Tabs / Buttons / Profile UI -----------------
function bindTabs() {
  $$(".tab").forEach((btn) => {
    btn.onclick = () => {
      $$(".tab").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const key = btn.dataset.tab;
      $$(".panel").forEach((p) => p.classList.remove("active"));
      $(`#tab-${key}`).classList.add("active");
    };
  });
}

function renderProfileUI() {
  const sel = $("#profileSelect");
  if (!sel) return;

  ensureProfileExists(activeProfile);
  const profiles = loadProfiles();
  sel.innerHTML = "";
  profiles.forEach((p) => {
    const o = document.createElement("option");
    o.value = p;
    o.textContent = p;
    if (p === activeProfile) o.selected = true;
    sel.appendChild(o);
  });

  sel.onchange = () => {
    activeProfile = sel.value;
    localStorage.setItem("dwr_active_profile", activeProfile);
    state = loadState();
    renderAll();
  };

  $("#btnNewProfile").onclick = () => {
    const name = prompt("Profile name (e.g., 'Keaton & Amy', 'Client - Jones'):");
    if (!name) return;
    ensureProfileExists(name);
    activeProfile = name;
    state = loadState();
    renderAll();
  };
}

function bindButtons() {
  $("#btnSave").onclick = () => {
    saveState();
    alert("Saved.");
  };
  $("#btnReset").onclick = resetAll;
  $("#btnExport").onclick = exportJSON;
  $("#fileImport").onchange = (e) => {
    const f = e.target.files?.[0];
    if (f) importJSON(f);
    e.target.value = "";
  };

  $("#addIncome").onclick = () => {
    state.income.push({ id: crypto.randomUUID(), name: "New Income", amount: 0, payDates: [], avgMode: "annualized" });
    saveState();
    renderAll();
  };
  $("#addBill").onclick = () => {
    state.bills.push({ id: crypto.randomUUID(), name: "New Bill", amount: 0, dueDay: 1 });
    saveState();
    renderAll();
  };

  const addDebt = $("#addDebt");
  if (addDebt)
    addDebt.onclick = () => {
      state.debts.push({ id: crypto.randomUUID(), name: "New Debt", balance: 0, apr: 0, minPay: 0, dueDay: 1, type: "card" });
      saveState();
      renderAll();
    };

  const addAsset = $("#addAsset");
  if (addAsset)
    addAsset.onclick = () => {
      state.assets.push({ id: crypto.randomUUID(), name: "New Asset", balance: 0, monthly: 0, type: "savings" });
      saveState();
      renderAll();
    };

  $("#addFreed").onclick = () => {
    state.freed.push({ id: crypto.randomUUID(), name: "Payment eliminated", amount: 0, month: monthKey(new Date()) });
    saveState();
    renderAll();
  };

  $("#btnSim").onclick = simulateCashflow;

  const runSim = $("#btnRunSim");
  if (runSim) runSim.onclick = renderSimulation;

  $("#btnPDF").onclick = generatePDF;

  $("#openPayModal").onclick = openPayModal;
  $("#closePayModal").onclick = closePayModal;
  $("#btnPreviewPayDates").onclick = previewPayDates;
  $("#btnGeneratePayDates").onclick = generateAndAddPayDates;
  $("#btnPasteClean").onclick = pasteAndCleanPayDates;
  $("#btnGenFromLast").onclick = genFromLastPay;

  $("#payMode").onchange = () => {
    const mode = $("#payMode").value;
    $("#modeEveryN").style.display = mode === "everyN" ? "" : "none";
    $("#modeWeekdays").style.display = mode === "weekdays" ? "" : "none";
  };

  $("#payModal").addEventListener("click", (e) => {
    if (e.target.id === "payModal") closePayModal();
  });
}

// ----------------- Render All -----------------
function renderAll() {
  bindInputs();
  renderProfileUI();

  renderIncome();
  renderBills();

  if (state.settings.modes.debt) renderDebts();
  else {
    const dl = $("#debtList");
    if (dl) dl.innerHTML = "";
  }

  if (state.settings.modes.invest) renderAssets();
  else {
    const al = $("#assetList");
    if (al) al.innerHTML = "";
  }

  renderLadder();
  build12MonthPreview();
  renderDashboard();
  renderHeatmap();
  renderNetWorthTimeline();
  renderScoreboard();
  renderFreed();

  applyModes();
}

// ----------------- Init -----------------
function init() {
  bindTabs();
  bindButtons();
  bindModeToggles();
  renderAll();
}

init();