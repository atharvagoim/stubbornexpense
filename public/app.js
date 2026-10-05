/* Expense Tracker — app logic */
(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const app = $("#app");

  /* ---------- fit the 390-wide design to the screen ---------- */
  const fit = () => {
    const w = window.innerWidth;
    // phones: fill the width exactly (unchanged). Laptops/tablets: a bigger, centred phone-shaped app sized to the screen height.
    const h = window.innerHeight;
    const z = w < 520 ? w / 390 : Math.max(1, Math.min(1.45, h / 680, (w - 48) / 390));
    document.documentElement.style.setProperty("--z", z.toFixed(4));
    document.documentElement.classList.toggle("wide", w >= 520);
  };
  fit();
  addEventListener("resize", fit);

  /* ---------- categories (names + icons from the design) ---------- */
  const CATS = {
    debit: [
      ["Travel", "travel"], ["Food", "food"], ["Fuel", "fuel"], ["Coke", "coke"], ["Shopping", "shopping"],
      ["Alcohol", "alcohol"], ["Bills", "bills"], ["Maintenance", "maintenance"], ["Groceries", "groceries"],
    ],
    credit: [["Salary", "salary"], ["Allowance", "allowance"]],
  };
  const ICON = Object.fromEntries([...CATS.debit, ...CATS.credit].map(([n, f]) => [n, `img/${f}.png`]));
  const CAT_COLOR = { Food: "#ff2d2d", Fuel: "#ff8a1f", Shopping: "#ffd21f", Alcohol: "#2bd45b", Travel: "#1f8bff", Maintenance: "#8b5cf6", Bills: "#ff4fa3", Groceries: "#ff6fb5", Coke: "#22d3ee", Custom: "#e5e5e5" };
  const DESIGN_ORDER = ["Food", "Fuel", "Shopping", "Alcohol", "Travel", "Maintenance", "Bills", "Groceries", "Coke", "Custom"];

  /* ---------- helpers ---------- */
  const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (n) => Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });
  const money = (n) => `₹ ${n < 0 ? "-" : ""}${num(Math.abs(n))}`;
  const plain = (n) => `₹ ${n < 0 ? "-" : ""}${Number(Math.abs(n)).toLocaleString("en-IN", { maximumFractionDigits: 2, useGrouping: false })}`;
  const rs = (n) => `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
  const ord = (d) => d + (d % 10 === 1 && d !== 11 ? "st" : d % 10 === 2 && d !== 12 ? "nd" : d % 10 === 3 && d !== 13 ? "rd" : "th");
  const when = (iso) => {
    const d = new Date(iso);
    const t = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    return `${t}, ${ord(d.getDate())} ${d.toLocaleString("en-US", { month: "short" })}`;
  };
  const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  let toastTimer;
  function toast(msg, err = false) {
    const t = $("#toast");
    t.textContent = msg; t.classList.toggle("err", err); t.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
  }

  async function api(path, { method = "GET", body } = {}) {
    const res = await fetch(path, {
      method, credentials: "same-origin",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = {};
    try { data = await res.json(); } catch {}
    if (!res.ok) { const e = new Error(data.error || "Something went wrong. Try again."); e.status = res.status; e.data = data; throw e; }
    return data;
  }

  /* ---------- state ---------- */
  const state = { user: null, txs: [], tab: localStorage.getItem("tab") || "history", sort: "new", from: "", to: "" };

  /* ---------- screens ---------- */
  function show(id) {
    $$(".screen").forEach((s) => (s.hidden = s.id !== id));
    document.body.classList.toggle("on-home", id === "s-home");
    document.documentElement.classList.toggle("locked", id !== "s-home"); // start, login + sign up never scroll the page
    window.scrollTo(0, 0);
  }

  /* ---------- overlays ---------- */
  function openOverlay(el) { el.hidden = false; el.classList.remove("closing"); document.body.style.overflow = "hidden"; }
  function closeOverlay(el) {
    if (el.hidden || el.classList.contains("closing")) return;
    el.classList.add("closing");
    setTimeout(() => { el.hidden = true; el.classList.remove("closing"); if (!$$(".overlay").some((o) => !o.hidden)) document.body.style.overflow = ""; }, 260);
  }
  $$(".overlay").forEach((o) => o.addEventListener("click", (e) => { if (e.target === o) closeOverlay(o); }));
  addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    closeMenus();
    $$(".overlay").filter((o) => !o.hidden).forEach(closeOverlay);
  });

  /* ---------- start / login ---------- */
  $("#go-start").addEventListener("click", () => { localStorage.setItem("seenStart", "1"); show("s-login"); });
  $("#go-login").addEventListener("click", () => openLoginPage());
  $("#go-signup").addEventListener("click", () => startSignup());

  let authMode = "login";
  const AUTH_FIELDS = {
    login: [["login", "Username or email", "text", "username"], ["password", "Password", "password", "current-password"]],
    signup: [["name", "Full name", "text", "name"], ["username", "Username", "text", "username"], ["email", "Email", "email", "email"], ["password", "Password (8+ characters)", "password", "new-password"]],
  };
  function openAuth(mode) {
    authMode = mode;
    $("#auth-title").textContent = mode === "login" ? "Login" : "Sign up";
    $("#auth-q").textContent = mode === "login" ? "New here?" : "Already have an account?";
    $("#auth-swap").textContent = mode === "login" ? "Sign up" : "Login";
    $("#auth-err").textContent = "";
    $("#auth-fields").innerHTML = AUTH_FIELDS[mode].map(([n, ph, type, ac]) =>
      `<label class="field" data-f="${n}"><input name="${n}" type="${type}" placeholder="${ph}" aria-label="${ph}" autocomplete="${ac}" ${type !== "password" ? 'autocapitalize="none" spellcheck="false"' : ""} maxlength="${n === "password" ? 200 : 120}"></label>`).join("");
    openOverlay($("#pop-auth"));
    setTimeout(() => $("#auth-fields input").focus(), 300);
  }
  $("#auth-swap").addEventListener("click", () => openAuth(authMode === "login" ? "signup" : "login"));
  $("#form-auth").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.currentTarget, btn = $(".done", f);
    const body = Object.fromEntries(new FormData(f));
    $$(".field", f).forEach((x) => x.classList.remove("bad")); $$("em", f).forEach((x) => x.remove());
    const empty = $$("input", f).find((i) => !i.value.trim());
    if (empty) { empty.parentElement.classList.add("bad"); empty.focus(); $("#auth-err").textContent = "Please fill in every field."; return; }
    btn.disabled = true;
    try {
      state.user = await api(authMode === "login" ? "/api/login" : "/api/signup", { method: "POST", body });
      closeOverlay($("#pop-auth"));
      await enterHome();
      toast(authMode === "login" ? `Welcome back, ${state.user.name.split(" ")[0]}` : `Welcome, ${state.user.name.split(" ")[0]}!`);
    } catch (err) {
      $("#auth-err").textContent = err.message;
      const fields = (err.data && err.data.fields) || {};
      Object.entries(fields).forEach(([k, msg]) => {
        const box = $(`.field[data-f="${k}"]`, f); if (!box) return;
        box.classList.add("bad"); box.insertAdjacentHTML("afterend", `<em>${esc(msg)}</em>`);
      });
    } finally { btn.disabled = false; }
  });

  /* ---------- home ---------- */
  async function enterHome() {
    show("s-home");
    setTab(state.tab, false);
    paintProfile();
    try { state.txs = await api("/api/transactions"); } catch (e) { if (e.status === 401) return logoutLocal(); toast(e.message, true); }
    render(true);
  }

  function balance() { return state.txs.reduce((s, t) => s + (t.type === "credit" ? t.amount : -t.amount), 0); }
  let shownBal = 0;
  function paintBalance(animate) {
    const el = $("#balance"), target = Math.round(balance() * 100) / 100;
    if (!animate) { shownBal = target; el.textContent = plain(target); return; }
    const from = shownBal, t0 = performance.now(), dur = 700;
    const step = (now) => {
      const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      const v = from + (target - from) * e;
      el.textContent = plain(k < 1 ? Math.round(v) : target);
      if (k < 1) requestAnimationFrame(step); else shownBal = target;
    };
    requestAnimationFrame(step);
  }

  function setTab(tab, save = true) {
    state.tab = tab === "analysis" ? "analysis" : "history";
    if (save) localStorage.setItem("tab", state.tab);
    $(".tabs").dataset.on = state.tab;
    $$(".tab").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === state.tab)));
    $("#v-history").hidden = state.tab !== "history";
    $("#v-analysis").hidden = state.tab !== "analysis";
    closeMenus();
    if (state.tab === "analysis") renderAnalysis();
  }
  $$(".tab").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));

  function render(animateBalance) {
    paintBalance(animateBalance);
    renderHistory();
    if (state.tab === "analysis") renderAnalysis();
  }

  /* history list */
  function visibleTxs() {
    let list = state.txs.slice();
    if (state.from) list = list.filter((t) => dayKey(new Date(t.createdAt)) >= state.from);
    if (state.to) list = list.filter((t) => dayKey(new Date(t.createdAt)) <= state.to);
    const by = {
      new: (a, b) => (a.createdAt < b.createdAt ? 1 : -1),
      old: (a, b) => (a.createdAt > b.createdAt ? 1 : -1),
      high: (a, b) => b.amount - a.amount,
      low: (a, b) => a.amount - b.amount,
    }[state.sort];
    return list.sort(by);
  }
  function iconHtml(cat) {
    return ICON[cat] ? `<img src="${ICON[cat]}" alt="">` : `<span class="q">?</span>`;
  }
  function renderHistory() {
    const list = visibleTxs();
    $("#tx-list").innerHTML = list.map((t, i) => `
      <li class="tx ${t.type}" data-id="${esc(t.id)}" style="--i:${Math.min(i, 12)}">
        <span class="tx-ic">${iconHtml(t.category)}</span>
        <span class="tx-name">${esc(t.category)}</span>
        <span class="tx-time">${esc(when(t.createdAt))}</span>
        <span class="tx-amt"><i>${t.type === "credit" ? "+" : "–"}</i>${num(t.amount)}</span>
        <button class="tx-del" type="button">Delete</button>
      </li>`).join("");
    const filtered = state.from || state.to;
    $("#tx-empty").hidden = list.length > 0;
    $("#tx-empty").innerHTML = filtered && state.txs.length ? "Nothing between these dates." : "No entries yet. Tap <b>CREDIT</b> or <b>DEBIT</b> to add one.";
    $("#chip-date").classList.toggle("on", !!filtered);
    $("#chip-sort").classList.toggle("on", state.sort !== "new");
  }
  // tap a row to show Delete, tap Delete to remove
  $("#tx-list").addEventListener("click", async (e) => {
    const row = e.target.closest(".tx"); if (!row) return;
    if (e.target.closest(".tx-del")) {
      const id = row.dataset.id;
      row.classList.add("gone");
      try {
        await api(`/api/transactions/${encodeURIComponent(id)}`, { method: "DELETE" });
        state.txs = state.txs.filter((t) => t.id !== id);
        setTimeout(() => render(true), 250);
        toast("Entry removed");
      } catch (err) { row.classList.remove("gone"); toast(err.message, true); }
      return;
    }
    const was = row.classList.contains("armed");
    $$(".tx.armed").forEach((r) => r.classList.remove("armed"));
    if (!was) row.classList.add("armed");
  });
  document.addEventListener("click", (e) => { if (!e.target.closest(".tx")) $$(".tx.armed").forEach((r) => r.classList.remove("armed")); });

  /* analysis */
  const ranges = { spend: "month", break: "month", month: "year" };
  const RANGE_LABEL = { month: "This Month", last: "Last Month", year: "This Year", all: "All Time" };
  function inRange(t, r) {
    const d = new Date(t.createdAt), now = new Date();
    if (r === "all") return true;
    if (r === "year") return d.getFullYear() === now.getFullYear();
    if (r === "month") return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return d.getFullYear() === lm.getFullYear() && d.getMonth() === lm.getMonth();
  }
  function spendBy(r) {
    const by = Object.fromEntries(DESIGN_ORDER.filter((c) => c !== "Coke").map((c) => [c, 0]));
    state.txs.filter((t) => t.type === "debit" && inRange(t, r)).forEach((t) => {
      const c = ICON[t.category] ? t.category : "Custom";
      by[c] = (by[c] || 0) + t.amount;
    });
    const total = Object.values(by).reduce((a, b) => a + b, 0);
    const rows = Object.entries(by).sort((a, b) => b[1] - a[1] || DESIGN_ORDER.indexOf(a[0]) - DESIGN_ORDER.indexOf(b[0]));
    return { rows, total };
  }
  const icon = (c) => (ICON[c] ? `<img src="${ICON[c]}" alt="">` : `<span class="q">?</span>`);
  const pct = (v, t) => (t ? Math.round((v / t) * 100) : 0);

  // smooth ring chart (SVG)
  function drawPixelRing(rows, total) {
    const svg = $("#pix"), R = 60, C = 2 * Math.PI * R;
    const segs = rows.filter(([, v]) => v > 0);
    let acc = 0;
    svg.innerHTML = `<circle cx="75" cy="75" r="${R}" stroke="#2a2a2a"></circle>` + segs.map(([cat, v]) => {
      const len = (v / total) * C, gap = segs.length > 1 ? Math.min(2, len / 3) : 0;
      const el = `<circle cx="75" cy="75" r="${R}" stroke="${CAT_COLOR[cat] || "#ccc"}" stroke-dasharray="0 ${C}" stroke-dashoffset="${-acc}" data-len="${Math.max(0, len - gap)}"></circle>`;
      acc += len;
      return el;
    }).join("");
    requestAnimationFrame(() => requestAnimationFrame(() => $$("circle[data-len]", svg).forEach((c) => c.setAttribute("stroke-dasharray", `${c.dataset.len} ${C}`))));
  }

  function renderAnalysis() {
    $$(".range").forEach((b) => { const k = b.closest(".c-spend") ? "spend" : b.closest(".c-break") ? "break" : "month"; b.textContent = RANGE_LABEL[ranges[k]]; });

    // Spending by Category
    const sp = spendBy(ranges.spend);
    $("#pix-total").textContent = rs(sp.total);
    drawPixelRing(sp.rows, sp.total);
    sp.rows = sp.rows.filter(([, v]) => v > 0);
    $("#sp-legend").innerHTML = sp.rows.length ? "" : "";
    $("#sp-legend").innerHTML = sp.rows.map(([cat, v], i) =>
      `<li class="sp" style="--i:${i}">${icon(cat)}<i class="sw" style="background:${CAT_COLOR[cat]}"></i><span>${esc(cat)}</span><em>${pct(v, sp.total)}%</em><b>${rs(v)}</b></li>`).join("");

    // Category Breakdown
    const bk = spendBy(ranges.break);
    bk.rows = bk.rows.filter(([, v]) => v > 0);
    const max = Math.max(1, ...bk.rows.map(([, v]) => v));
    $("#bk-list").innerHTML = bk.rows.map(([cat, v], i) =>
      `<li class="bk" style="--i:${i}">${icon(cat)}<span>${esc(cat)}</span><b><small>${pct(v, bk.total)}%</small>${rs(v)}</b><span class="bk-bar"><i data-w="${Math.round((v / max) * 100)}" style="background:${CAT_COLOR[cat]}"></i></span></li>`).join("") || `<li class="a-empty">No spending in this period yet.</li>`;
    requestAnimationFrame(() => requestAnimationFrame(() => $$(".bk-bar i").forEach((b) => (b.style.width = b.dataset.w + "%"))));

    // Monthly Expenses
    const now = new Date(), year = now.getFullYear();
    const months = [...Array(12)].map((_, m) => state.txs.filter((t) => {
      if (t.type !== "debit") return false;
      const d = new Date(t.createdAt);
      if (ranges.month === "year" || ranges.month === "month" || ranges.month === "last") return d.getFullYear() === year && d.getMonth() === m;
      return d.getMonth() === m;
    }).reduce((a, t) => a + t.amount, 0));
    const top = Math.max(...months, 1);
    const step = Math.pow(10, Math.floor(Math.log10(top))) * (top / Math.pow(10, Math.floor(Math.log10(top))) > 5 ? 2 : 1);
    const axisMax = Math.max(step * 4, Math.ceil(top / step) * step);
    const k = (v) => (v >= 1000 ? `${+(v / 1000).toFixed(1)}K` : `${v}`);
    $("#m-axis").innerHTML = [0, 1, 2, 3, 4].map((i) => `<span style="top:${(1 - i / 4) * (190 - 22)}px">${k(Math.round((axisMax * i) / 4))}</span>`).join("");
    $("#m-bars").innerHTML = months.map((v, m) =>
      `<div class="mb${m === now.getMonth() ? " now" : ""}" style="--i:${m}" title="${rs(v)}"><i data-h="${(v / axisMax) * 100}"></i><span>${new Date(2000, m, 1).toLocaleString("en-US", { month: "short" })}</span></div>`).join("");
    requestAnimationFrame(() => requestAnimationFrame(() => $$(".mb i").forEach((b) => (b.style.height = b.dataset.h + "%"))));
  }

  /* ---------- add credit / debit ---------- */
  const forms = { debit: $("#form-debit"), credit: $("#form-credit") };
  const pick = { debit: "", credit: "" };
  function buildList(type) {
    const ul = $(`#list-${type}`);
    const chosen = pick[type];
    const head = chosen === "__custom"
      ? `<li class="pk-head" data-cat="__custom"><input class="pk-custom-in" placeholder="Type a name" aria-label="Custom category" maxlength="30"></li>`
      : `<li class="pk-head" data-cat="${chosen}" role="button" aria-label="Choose category">${icon(chosen)}<span>${esc(chosen)}</span></li>`;
    const rest = CATS[type].filter(([n]) => n !== chosen).map(([n], i) =>
      `<li class="pk" role="option" data-cat="${n}" style="--i:${i}"><img src="${ICON[n]}" alt=""><span>${n}</span></li>`).join("") +
      (chosen === "__custom" ? "" : `<li class="pk pk-custom" role="option" data-cat="__custom" style="--i:${CATS[type].length}"><span>? Custom</span></li>`);
    ul.innerHTML = head + `<li><ul class="pk-rest" role="listbox">${rest}</ul></li>`;
    const ci = $(".pk-custom-in", ul);
    if (ci) setTimeout(() => ci.focus(), 50);
  }
  ["debit", "credit"].forEach((type) => {
    const ul = $(`#list-${type}`), picker = ul.closest(".picker");
    ul.addEventListener("click", (e) => {
      if (e.target.closest(".pk-custom-in")) return;
      if (e.target.closest(".pk-head")) { picker.classList.toggle("closed"); return; }
      const li = e.target.closest(".pk"); if (!li) return;
      const keep = $(".pk-custom-in", ul) ? $(".pk-custom-in", ul).value : "";
      pick[type] = li.dataset.cat;
      picker.classList.remove("bad");
      buildList(type);
      if (pick[type] !== "__custom") picker.classList.add("closed");
      if (pick[type] === "__custom" && keep) $(".pk-custom-in", ul).value = keep;
    });
    forms[type].addEventListener("submit", (e) => { e.preventDefault(); submitTx(type); });
  });
  function openAdd(type) {
    const f = forms[type];
    f.reset(); pick[type] = CATS[type][0][0];
    buildList(type);
    $(".picker", f).classList.add("closed");
    $$(".bad", f).forEach((x) => x.classList.remove("bad"));
    openOverlay($(`#pop-${type}`));
    setTimeout(() => $("input[name=amount]", f).focus(), 320);
  }
  $("#add-debit").addEventListener("click", () => openAdd("debit"));
  $("#add-credit").addEventListener("click", () => openAdd("credit"));
  // amount: digits and one dot only
  $$("input[name=amount]").forEach((i) => i.addEventListener("input", () => {
    let v = i.value.replace(/[^\d.]/g, "");
    const p = v.split("."); if (p.length > 2) v = p[0] + "." + p.slice(1).join("");
    if (p[1] && p[1].length > 2) v = p[0] + "." + p[1].slice(0, 2);
    i.value = v;
    i.parentElement.classList.remove("bad");
  }));

  async function submitTx(type) {
    const f = forms[type], btn = $(".done", f);
    const amtInput = $("input[name=amount]", f);
    const amount = parseFloat(amtInput.value);
    if (!(amount > 0)) { amtInput.parentElement.classList.remove("bad"); void amtInput.offsetWidth; amtInput.parentElement.classList.add("bad"); amtInput.focus(); return toast("Enter an amount", true); }
    const custom = pick[type] === "__custom";
    const category = custom ? ($(".pk-custom-in", f) ? $(".pk-custom-in", f).value.trim() : "") : pick[type];
    if (!category) { const p = $(".picker", f); p.classList.remove("bad"); void p.offsetWidth; p.classList.add("bad"); return toast(custom ? "Type your custom category" : "Pick a category", true); }
    btn.disabled = true;
    try {
      const t = await api("/api/transactions", { method: "POST", body: { type, amount, category, custom } });
      state.txs.unshift(t);
      closeOverlay($(`#pop-${type}`));
      render(true);
      const b = $("#balance"); b.classList.remove("bump"); void b.offsetWidth; b.classList.add("bump");
      toast(`${type === "credit" ? "+" : "−"} ${money(amount)} · ${category}`);
    } catch (err) {
      if (err.status === 401) return logoutLocal();
      toast(err.message, true);
    } finally { btn.disabled = false; }
  }

  /* ---------- date + sort menus ---------- */
  const menus = { date: $("#menu-date"), sort: $("#menu-sort"), range: $("#menu-range") };
  Object.values(menus).forEach((m) => app.appendChild(m)); // live inside the zoomed canvas
  function offsetIn(el) { let x = 0, y = 0; for (let n = el; n && n !== app; n = n.offsetParent) { x += n.offsetLeft; y += n.offsetTop; } return { x, y }; }
  function closeMenus() { Object.values(menus).forEach((m) => (m.hidden = true)); }
  function toggleMenu(name, chip) {
    const m = menus[name], open = m.hidden;
    closeMenus();
    if (!open) return;
    m.hidden = false;
    const o = offsetIn(chip);
    m.style.top = o.y + 28 + "px";
    m.style.left = Math.max(10, Math.min(390 - m.offsetWidth - 10, o.x + chip.offsetWidth - m.offsetWidth)) + "px";
  }
  $("#chip-date").addEventListener("click", (e) => { e.stopPropagation(); $("#d-from").value = state.from; $("#d-to").value = state.to; toggleMenu("date", e.currentTarget); });
  $("#chip-sort").addEventListener("click", (e) => { e.stopPropagation(); $$("#menu-sort button").forEach((b) => b.classList.toggle("on", b.dataset.sort === state.sort)); toggleMenu("sort", e.currentTarget); });
  Object.values(menus).forEach((m) => m.addEventListener("click", (e) => e.stopPropagation()));
  document.addEventListener("click", closeMenus);
  $$("#menu-sort button").forEach((b) => b.addEventListener("click", () => { state.sort = b.dataset.sort; closeMenus(); renderHistory(); }));
  $("#d-apply").addEventListener("click", () => {
    let a = $("#d-from").value, b = $("#d-to").value;
    if (a && b && a > b) [a, b] = [b, a];
    state.from = a; state.to = b; closeMenus(); renderHistory();
  });
  let rangeKey = "spend";
  $$(".range").forEach((b) => b.addEventListener("click", (e) => {
    e.stopPropagation();
    rangeKey = b.closest(".c-spend") ? "spend" : b.closest(".c-break") ? "break" : "month";
    $$("#menu-range button").forEach((x) => { x.classList.toggle("on", x.dataset.r === ranges[rangeKey]); x.hidden = rangeKey === "month" && x.dataset.r !== "year" && x.dataset.r !== "all"; });
    toggleMenu("range", b);
  }));
  $$("#menu-range button").forEach((x) => x.addEventListener("click", () => { ranges[rangeKey] = x.dataset.r; closeMenus(); renderAnalysis(); }));
  $("#d-clear").addEventListener("click", () => { state.from = state.to = ""; closeMenus(); renderHistory(); });

  /* ---------- profile drawer ---------- */
  function paintProfile() {
    const u = state.user || {};
    const img = $("#avatar-img");
    $("#me-name").textContent = u.name || "";
    $$("#avatar-img, #me-pic-img").forEach((im) => { if (u.avatar) { im.src = u.avatar; im.hidden = false; } else { im.removeAttribute("src"); im.hidden = true; } });
    $("#av-remove").classList.toggle("off", !u.avatar);
    $$(".pf").forEach((pf) => { $("input", pf).value = u[pf.dataset.key] || ""; });
  }
  $("#open-menu").addEventListener("click", () => { paintProfile(); openOverlay($("#pop-menu")); });
  ["#me-pic", "#me-name"].forEach((s) => $(s).addEventListener("click", () => { paintProfile(); openOverlay($("#pop-menu")); }));

  $("#av-edit").addEventListener("click", () => $("#av-file").click());
  /* crop the photo before saving: drag to move, pinch / wheel / slider to zoom */
  const crop = { img: null, w: 0, h: 0, base: 1, zoom: 1, x: 0, y: 0, url: "" };
  const BOX = 280, HOLE = BOX - 28; // circle inset 14px
  const cropImg = $("#crop-img"), zoomEl = $("#crop-zoom");
  function clampCrop() {
    const s = crop.base * crop.zoom, w = crop.w * s, h = crop.h * s, m = 14;
    crop.x = Math.min(m, Math.max(BOX - m - w, crop.x));
    crop.y = Math.min(m, Math.max(BOX - m - h, crop.y));
  }
  function paintCrop() { clampCrop(); cropImg.style.transform = `translate(${crop.x}px, ${crop.y}px) scale(${crop.base * crop.zoom})`; }
  function zoomTo(z, cx = BOX / 2, cy = BOX / 2) {
    z = Math.min(4, Math.max(1, z));
    const s0 = crop.base * crop.zoom, s1 = crop.base * z;
    crop.x = cx - ((cx - crop.x) / s0) * s1; crop.y = cy - ((cy - crop.y) / s0) * s1;
    crop.zoom = z; zoomEl.value = z; paintCrop();
  }
  $("#av-file").addEventListener("change", (e) => {
    const file = e.target.files[0]; e.target.value = "";
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return toast("Use a JPG, PNG or WebP photo", true);
    if (crop.url) URL.revokeObjectURL(crop.url);
    crop.url = URL.createObjectURL(file);
    cropImg.onload = () => {
      crop.w = cropImg.naturalWidth; crop.h = cropImg.naturalHeight;
      crop.base = HOLE / Math.min(crop.w, crop.h); crop.zoom = 1; zoomEl.value = 1;
      cropImg.style.width = crop.w + "px"; cropImg.style.height = crop.h + "px";
      crop.x = (BOX - crop.w * crop.base) / 2; crop.y = (BOX - crop.h * crop.base) / 2;
      paintCrop(); openOverlay($("#pop-crop"));
    };
    cropImg.onerror = () => toast("Could not open that photo", true);
    cropImg.src = crop.url;
  });
  zoomEl.addEventListener("input", () => zoomTo(parseFloat(zoomEl.value)));
  const pts = new Map(); let pinch = null;
  const box = $("#crop-box");
  const local = (e) => { const r = box.getBoundingClientRect(), k = BOX / r.width; return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k, k }; };
  box.addEventListener("pointerdown", (e) => { box.setPointerCapture(e.pointerId); pts.set(e.pointerId, local(e)); if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: crop.zoom }; } });
  box.addEventListener("pointermove", (e) => {
    if (!pts.has(e.pointerId)) return;
    const p = local(e), prev = pts.get(e.pointerId); pts.set(e.pointerId, p);
    if (pts.size === 2 && pinch) { const [a, b] = [...pts.values()]; zoomTo(pinch.z * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.d), (a.x + b.x) / 2, (a.y + b.y) / 2); }
    else if (pts.size === 1) { crop.x += p.x - prev.x; crop.y += p.y - prev.y; paintCrop(); }
  });
  const up = (e) => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; };
  box.addEventListener("pointerup", up); box.addEventListener("pointercancel", up);
  box.addEventListener("wheel", (e) => { e.preventDefault(); const p = local(e); zoomTo(crop.zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08), p.x, p.y); }, { passive: false });
  $("#crop-cancel").addEventListener("click", () => closeOverlay($("#pop-crop")));
  $("#crop-save").addEventListener("click", async () => {
    const btn = $("#crop-save"); btn.disabled = true;
    try {
      const out = 256, cv = document.createElement("canvas"); cv.width = cv.height = out;
      const s = crop.base * crop.zoom;
      const sx = (14 - crop.x) / s, sy = (14 - crop.y) / s, sw = HOLE / s;
      const ctx = cv.getContext("2d"); ctx.imageSmoothingQuality = "high";
      ctx.drawImage(cropImg, sx, sy, sw, sw, 0, 0, out, out);
      const avatar = cv.toDataURL("image/jpeg", 0.86);
      state.user = await api("/api/me", { method: "PATCH", body: { avatar } });
      paintProfile(); if (!suScreen.hidden) { $$(".su-pic").forEach((x) => x.classList.remove("sel")); paintSuAvatar(); }
      closeOverlay($("#pop-crop")); toast("Photo updated");
    } catch (err) { toast(err.message || "Could not use that photo", true); }
    finally { btn.disabled = false; }
  });
  $("#av-remove").addEventListener("click", async () => {
    if (!(state.user && state.user.avatar)) return toast("No photo to remove");
    try { state.user = await api("/api/me", { method: "PATCH", body: { avatar: "" } }); paintProfile(); toast("Photo removed"); }
    catch (err) { toast(err.message, true); }
  });

  $$(".pf").forEach((pf) => {
    const input = $("input", pf), key = pf.dataset.key;
    if (key === "email") return;
    const start = () => { pf.classList.add("editing"); input.readOnly = false; input.focus(); input.setSelectionRange(input.value.length, input.value.length); };
    const cancel = () => { pf.classList.remove("editing", "bad"); input.readOnly = true; input.value = (state.user || {})[key] || ""; };
    const save = async () => {
      if (input.readOnly) return;
      const v = input.value.trim();
      if (v === ((state.user || {})[key] || "")) return cancel();
      try {
        state.user = await api("/api/me", { method: "PATCH", body: { [key]: v } });
        pf.classList.remove("editing", "bad"); input.readOnly = true; paintProfile(); toast("Saved");
      } catch (err) { pf.classList.add("bad"); toast(err.message, true); input.focus(); }
    };
    $(".pf-edit", pf).addEventListener("mousedown", (e) => e.preventDefault());
    $(".pf-edit", pf).addEventListener("click", () => (input.readOnly ? start() : save()));
    input.addEventListener("dblclick", start);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); save(); } if (e.key === "Escape") { e.stopPropagation(); cancel(); } });
    input.addEventListener("blur", () => setTimeout(save, 120));
  });

  function logoutLocal() {
    state.user = null; state.txs = [];
    $$(".overlay").forEach((o) => { o.hidden = true; });
    document.body.style.overflow = "";
    show("s-start");
  }
  $("#logout").addEventListener("click", async () => {
    try { await api("/api/logout", { method: "POST" }); } catch {}
    closeOverlay($("#pop-menu"));
    setTimeout(logoutLocal, 260);
    toast("Logged out");
  });

  /* delete account (password required) */
  $("#del-acc").addEventListener("click", () => {
    const f = $("#form-delete"); f.reset(); $("#del-err").textContent = ""; $(".field", f).classList.remove("bad");
    openOverlay($("#pop-delete"));
    setTimeout(() => $("input", f).focus(), 300);
  });
  $$(".sh-close").forEach((b) => b.addEventListener("click", () => closeOverlay(b.closest(".overlay"))));
  $("#del-cancel").addEventListener("click", () => closeOverlay($("#pop-delete")));
  $("#form-delete").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.currentTarget, input = $("input", f), btn = $(".del-go", f);
    if (!input.value) { input.parentElement.classList.add("bad"); $("#del-err").textContent = "Enter your password."; return; }
    btn.disabled = true;
    try {
      await api("/api/me", { method: "DELETE", body: { password: input.value } });
      localStorage.removeItem("tab");
      logoutLocal();
      toast("Account deleted");
    } catch (err) {
      input.parentElement.classList.remove("bad"); void input.offsetWidth; input.parentElement.classList.add("bad");
      $("#del-err").textContent = err.message; input.select();
    } finally { btn.disabled = false; }
  });

  /* ---------- login page ---------- */
  function openLoginPage() {
    const f = $("#li-form"); f.reset(); $("#li-err").textContent = "";
    $$(".su-in", f).forEach((i) => i.classList.remove("bad"));
    show("s-loginpage");
    f.style.animation = "none"; void f.offsetWidth; f.style.animation = "";
    setTimeout(() => $("[name=login]", f).focus(), 250);
  }
  $("#li-back").addEventListener("click", () => show("s-login"));
  $("#li-signup").addEventListener("click", () => startSignup());
  $("#li-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.currentTarget, btn = $(".su-next", f);
    const login = $("[name=login]", f), pw = $("[name=password]", f);
    const fail = (input, msg) => { $("#li-err").textContent = msg; input.classList.remove("bad"); void input.offsetWidth; input.classList.add("bad"); input.focus(); };
    $$(".su-in", f).forEach((i) => i.classList.remove("bad"));
    if (!login.value.trim()) return fail(login, "Enter your username or email.");
    if (!pw.value) return fail(pw, "Enter your password.");
    btn.disabled = true;
    try {
      state.user = await api("/api/login", { method: "POST", body: { login: login.value.trim(), password: pw.value } });
      await enterHome();
      toast(`Welcome back, ${(state.user.name || "").split(" ")[0]}`);
    } catch (err) { fail(pw, err.message); pw.select(); }
    finally { btn.disabled = false; }
  });

  /* ---------- sign up: one question per screen, then a profile picture ---------- */
  const SU_ORDER = ["name", "username", "email", "password", "pfp"];
  const su = { data: {}, step: "name" };
  const suScreen = $("#s-signup");
  $$(".su-pic").forEach((b, i) => b.style.setProperty("--n", i));
  function suGo(step, back = false) {
    su.step = step; suScreen.dataset.step = step;
    $$(".su-step", suScreen).forEach((f) => { const on = f.dataset.step === step; f.hidden = !on; if (on) { f.classList.toggle("back", back); f.style.animation = "none"; void f.offsetWidth; f.style.animation = ""; } });
    const ix = SU_ORDER.indexOf(step);
    $$("#su-dots i").forEach((d, i) => { d.classList.toggle("on", i === ix); d.classList.toggle("done", i < ix); });
    const f = $(`.su-step[data-step="${step}"]`, suScreen);
    $$(".su-err", f).forEach((e) => (e.textContent = ""));
    $$(".su-in", f).forEach((i) => i.classList.remove("bad"));
    const first = $(".su-in", f);
    if (first) setTimeout(() => first.focus(), 250);
  }
  function startSignup() {
    su.data = {};
    $$(".su-step", suScreen).forEach((f) => f.reset && f.reset());
    show("s-signup"); suGo("name");
  }
  $("#su-back").addEventListener("click", () => {
    const ix = SU_ORDER.indexOf(su.step);
    if (ix <= 0) return show("s-login");
    suGo(SU_ORDER[ix - 1], true);
  });
  const suFail = (f, input, msg) => { const e = $(".su-err", f); e.textContent = msg; input.classList.remove("bad"); void input.offsetWidth; input.classList.add("bad"); input.focus(); };
  $$("form.su-step", suScreen).forEach((f) => f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const step = f.dataset.step, btn = $(".su-next", f);
    const val = (n) => $(`[name="${n}"]`, f).value.trim();
    btn.disabled = true;
    try {
      if (step === "name") {
        if (!val("name")) return suFail(f, $("[name=name]", f), "Please enter your name.");
        su.data.name = val("name"); return suGo("username");
      }
      if (step === "username") {
        const u = val("username").toLowerCase().replace(/^@/, "");
        if (!/^[a-z0-9._]{3,20}$/.test(u)) return suFail(f, $("[name=username]", f), "Use 3–20 letters, numbers, . or _");
        const r = await api(`/api/check?username=${encodeURIComponent(u)}`);
        if (r.username === "taken") return suFail(f, $("[name=username]", f), "That username is taken. Try another.");
        su.data.username = u; return suGo("email");
      }
      if (step === "email") {
        const em = val("email").toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(em)) return suFail(f, $("[name=email]", f), "Enter a valid email address.");
        const r = await api(`/api/check?email=${encodeURIComponent(em)}`);
        if (r.email === "taken") return suFail(f, $("[name=email]", f), "This email already has an account. Try logging in.");
        su.data.email = em; return suGo("password");
      }
      if (step === "password") {
        const p = $("[name=password]", f).value, c = $("[name=confirm]", f).value;
        if (p.length < 8) return suFail(f, $("[name=password]", f), "Use at least 8 characters.");
        if (p !== c) return suFail(f, $("[name=confirm]", f), "Passwords don't match.");
        state.user = await api("/api/signup", { method: "POST", body: { ...su.data, password: p } });
        paintSuAvatar(); return suGo("pfp");
      }
    } catch (err) {
      const field = err.data && err.data.fields ? Object.keys(err.data.fields)[0] : "";
      if (field === "password") suFail(f, $("[name=password]", f), err.data.fields.password);
      else if (field && SU_ORDER.includes(field)) { suGo(field, true); const g = $(`.su-step[data-step="${field}"]`, suScreen); suFail(g, $(`[name="${field}"]`, g), err.data.fields[field]); }
      else $(".su-err", f).textContent = err.message;
    } finally { btn.disabled = false; }
  }));

  // step 5: profile picture
  function paintSuAvatar() {
    const u = state.user || {}, img = $("#su-avatar-img");
    if (u.avatar) { img.src = u.avatar; img.hidden = false; } else { img.removeAttribute("src"); img.hidden = true; }
    $("#su-remove").classList.toggle("off", !u.avatar);
    $("#su-skip").textContent = u.avatar ? "Done" : "Skip";
    const av = $("#su-avatar"); av.classList.remove("pop"); void av.offsetWidth; av.classList.add("pop");
  }
  async function srcToAvatar(src) {
    const im = new Image(); im.src = src; await im.decode();
    const s = 256, c = document.createElement("canvas"); c.width = c.height = s;
    const k = Math.max(s / im.naturalWidth, s / im.naturalHeight), w = im.naturalWidth * k, h = im.naturalHeight * k;
    c.getContext("2d").drawImage(im, (s - w) / 2, (s - h) / 2, w, h);
    return c.toDataURL("image/jpeg", 0.86);
  }
  $$(".su-pic").forEach((b) => b.addEventListener("click", async () => {
    $$(".su-pic").forEach((x) => x.classList.toggle("sel", x === b));
    try { state.user = await api("/api/me", { method: "PATCH", body: { avatar: await srcToAvatar(b.dataset.src) } }); paintSuAvatar(); }
    catch (err) { toast(err.message, true); }
  }));
  $("#su-edit").addEventListener("click", () => $("#av-file").click());
  $("#su-remove").addEventListener("click", async () => {
    if (!(state.user && state.user.avatar)) return;
    try { state.user = await api("/api/me", { method: "PATCH", body: { avatar: "" } }); $$(".su-pic").forEach((x) => x.classList.remove("sel")); paintSuAvatar(); }
    catch (err) { toast(err.message, true); }
  });
  $("#su-skip").addEventListener("click", async () => {
    await enterHome();
    toast(`Welcome, ${(state.user.name || "").split(" ")[0]}!`);
  });

  /* ---------- the face on Get Started / Login changes every second ---------- */
  let faceIx = 0;
  setInterval(() => {
    const scr = $$(".s-start, .s-login").find((s) => !s.hidden);
    if (!scr || document.hidden) return;
    faceIx = (faceIx + 1) % 3;
    $$(".faces").forEach((wrap) => {
      $$(".face", wrap).forEach((im, i) => im.classList.toggle("on", i === faceIx));
      if (!matchMedia("(prefers-reduced-motion: reduce)").matches) { wrap.classList.remove("hit"); void wrap.offsetWidth; wrap.classList.add("hit"); }
    });
  }, 1000);

  /* ---------- AI quick entry: speak or type, it picks credit/debit + category ---------- */
  const dock = $("#ai-dock"), aiText = $("#ai-text"), aiRes = $("#ai-result"), aiSend = $("#ai-send"), aiMic = $("#ai-mic");
  let aiTimer;
  function showAiResult(html, err = false, ms = 7000) {
    aiRes.innerHTML = html; aiRes.classList.toggle("err", err); aiRes.hidden = false;
    aiRes.style.animation = "none"; void aiRes.offsetWidth; aiRes.style.animation = "";
    clearTimeout(aiTimer); aiTimer = setTimeout(() => (aiRes.hidden = true), ms);
  }
  async function aiSubmit() {
    const text = aiText.value.trim();
    if (!text) { aiText.focus(); return; }
    dock.classList.add("busy"); aiSend.disabled = true;
    try {
      const r = await api("/api/ai/parse", { method: "POST", body: { text } });
      state.txs.unshift(...r.added.slice().reverse());
      state.txs.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      render(true);
      const b = $("#balance"); b.classList.remove("bump"); void b.offsetWidth; b.classList.add("bump");
      aiText.value = "";
      const ids = r.added.map((t) => t.id);
      showAiResult(`<div class="ai-res-head"><span>Added ${r.added.length} ${r.added.length > 1 ? "entries" : "entry"}</span><button type="button" class="ai-undo">Undo</button></div>` +
        r.added.map((t) => `<div class="ai-row">${icon(t.category)}<b>${esc(t.category)}</b><span class="amt ${t.type}"><i>${t.type === "credit" ? "+" : "–"}</i>₹${num(t.amount)}</span></div>`).join(""));
      $(".ai-undo", aiRes).addEventListener("click", async () => {
        aiRes.hidden = true;
        try {
          await Promise.all(ids.map((id) => api(`/api/transactions/${encodeURIComponent(id)}`, { method: "DELETE" })));
          state.txs = state.txs.filter((t) => !ids.includes(t.id));
          render(true); toast("Undone");
        } catch (e) { toast(e.message, true); }
      });
    } catch (err) {
      if (err.status === 401) return logoutLocal();
      showAiResult(esc(err.message), true, 4500);
    } finally { dock.classList.remove("busy"); aiSend.disabled = false; }
  }
  dock.addEventListener("submit", (e) => { e.preventDefault(); stopListening(); aiSubmit(); });

  // microphone (Chrome, Edge, Safari): speech → text → added automatically
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null, heard = "";
  function stopListening() { if (rec) { try { rec.stop(); } catch {} } }
  if (!SR) aiMic.hidden = true;
  aiMic.addEventListener("click", () => {
    if (rec) return stopListening();
    rec = new SR(); heard = "";
    rec.lang = navigator.language && navigator.language.startsWith("en") ? navigator.language : "en-IN";
    rec.interimResults = true; rec.maxAlternatives = 1; rec.continuous = false;
    rec.onstart = () => { dock.classList.add("listening"); aiText.value = ""; aiText.placeholder = "Listening… say it like “spent 200 on food”"; };
    rec.onresult = (e) => { heard = [...e.results].map((x) => x[0].transcript).join(" "); aiText.value = heard; };
    rec.onerror = (e) => { if (e.error === "not-allowed" || e.error === "service-not-allowed") toast("Allow microphone access to speak", true); else if (e.error !== "no-speech" && e.error !== "aborted") toast("Couldn't hear that. Try again.", true); };
    rec.onend = () => {
      dock.classList.remove("listening"); aiText.placeholder = "Spent 250 on uber, got 5000 salary…"; rec = null;
      if (heard.trim()) aiSubmit();
    };
    try { rec.start(); } catch { rec = null; toast("Microphone isn't available here", true); }
  });

  /* ---------- show / hide on every password box ---------- */
  const EYE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path class="slash" d="M4 4l16 16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  function eyeify(input) {
    if (input.dataset.eye) return;
    input.dataset.eye = "1";
    const wrap = document.createElement("span");
    wrap.className = "pw-wrap" + (input.classList.contains("su-in") ? " pw-su" : "");
    input.parentNode.insertBefore(wrap, input); wrap.appendChild(input);
    const b = document.createElement("button");
    b.type = "button"; b.className = "pw-eye"; b.innerHTML = EYE;
    b.setAttribute("aria-label", "Show password"); b.setAttribute("aria-pressed", "false");
    b.addEventListener("mousedown", (e) => e.preventDefault()); // keep the keyboard open
    b.addEventListener("click", () => {
      const show = input.type === "password";
      const pos = input.selectionStart;
      input.type = show ? "text" : "password";
      b.classList.toggle("on", show); b.setAttribute("aria-pressed", String(show)); b.setAttribute("aria-label", show ? "Hide password" : "Show password");
      input.focus(); try { input.setSelectionRange(pos, pos); } catch {}
    });
    wrap.appendChild(b);
    // always hide again when the form is reset or sent
    const f = input.form; if (f && !f.dataset.eyeReset) { f.dataset.eyeReset = "1"; const hide = () => $$(".pw-eye.on", f).forEach((x) => x.click()); f.addEventListener("reset", hide); f.addEventListener("submit", () => setTimeout(hide, 0)); }
  }
  const eyeAll = (root) => $$('input[type="password"]', root).forEach(eyeify);
  eyeAll(document);
  new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => { if (n.nodeType === 1) { if (n.matches('input[type="password"]')) eyeify(n); else eyeAll(n); } })))
    .observe(document.body, { childList: true, subtree: true });

  /* ---------- boot ---------- */
  (async () => {
    try {
      state.user = await api("/api/me");
      await enterHome();
    } catch {
      show(localStorage.getItem("seenStart") ? "s-login" : "s-start");
    }
  })();
})();
