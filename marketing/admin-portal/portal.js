/* ============================================================
   SIGHTLINE ADMIN PORTAL
   Vanilla hash-routed SPA. No dependencies, no build step.
   Talks to the backend at window.SIGHTLINE_API.

   SECURITY RULE: every piece of server-provided data that is
   interpolated into an innerHTML template MUST pass through
   esc(). Demo-request names/messages, org names, email subjects
   etc. are attacker-controlled. fmtDate/fmtDateTime/fmtMoney/
   fmtInt and pill() escape internally.
   ============================================================ */

(function () {
  "use strict";

  /* ---------- config + state ---------- */

  var API_BASE = window.SIGHTLINE_API || "http://localhost:8000";
  var TOKEN_KEY = "sl_admin_token";
  var EMAIL_KEY = "sl_admin_email";

  var LOGO_SVG =
    '<svg class="mark" viewBox="0 0 32 32" aria-hidden="true">' +
    '<g fill="currentColor" opacity=".32">' +
    '<rect x="3" y="3" width="7" height="7" rx="2.2"/><rect x="12.5" y="3" width="7" height="7" rx="2.2"/><rect x="22" y="3" width="7" height="7" rx="2.2"/>' +
    '<rect x="3" y="12.5" width="7" height="7" rx="2.2"/><rect x="22" y="12.5" width="7" height="7" rx="2.2"/>' +
    '<rect x="3" y="22" width="7" height="7" rx="2.2"/><rect x="12.5" y="22" width="7" height="7" rx="2.2"/><rect x="22" y="22" width="7" height="7" rx="2.2"/>' +
    "</g>" +
    '<rect x="12.5" y="12.5" width="7" height="7" rx="2.2" fill="var(--accent)"/></svg>';

  var PAGE_SIZE = 50;

  // per-session UI state (filters + pages survive navigation, not reload)
  var state = {
    demoStatus: "",     // "" = all | new | contacted | archived | converted
    outboxStatus: "",   // "" = all | captured | pending | sent | failed
    showRemoved: false,
    orgQuery: "",
    auditAction: "",
    auditOrg: "",
    demoPage: 0,
    orgsPage: 0,
    auditPage: 0,
    outboxPage: 0,
  };

  var viewEl = document.getElementById("view");
  var modalMount = document.getElementById("modal-mount");
  var toastMount = document.getElementById("toast-mount");
  var emailEl = document.getElementById("admin-email");

  function getToken() {
    try { return sessionStorage.getItem(TOKEN_KEY); } catch (e) { return null; }
  }

  function setSession(token, email) {
    try {
      sessionStorage.setItem(TOKEN_KEY, token);
      if (email) sessionStorage.setItem(EMAIL_KEY, email);
    } catch (e) { /* storage unavailable */ }
  }

  function clearSession() {
    try {
      sessionStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(EMAIL_KEY);
    } catch (e) { /* storage unavailable */ }
  }

  /* ---------- escaping + formatting helpers ---------- */

  function esc(v) {
    if (v === null || v === undefined) return "";
    return String(v)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function fmtDate(iso) {
    if (!iso) return "—";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    return esc(
      d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })
    );
  }

  function fmtDateTime(iso) {
    if (!iso) return "—";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    // title carries the exact ISO stamp for anyone who needs precision
    return (
      '<span class="p-ts" title="' + esc(iso) + '">' +
      esc(
        d.toLocaleString("en-US", {
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })
      ) +
      "</span>"
    );
  }

  // short local timezone label, e.g. "EDT" — declared once per table
  function tzLabel() {
    try {
      var parts = new Date().toLocaleTimeString("en-US", { timeZoneName: "short" }).split(" ");
      return esc(parts[parts.length - 1]);
    } catch (e) {
      return "local";
    }
  }

  // identifiers: monospace, middle-truncated, click-to-copy the full value
  function idChip(id) {
    if (!id) return "—";
    var s = String(id);
    var short = s.length > 14 ? s.slice(0, 8) + "…" + s.slice(-4) : s;
    return (
      '<span class="p-id" data-action="copy" data-copy="' + esc(s) +
      '" title="Click to copy ' + esc(s) + '" role="button" tabindex="0">' +
      esc(short) + "</span>"
    );
  }

  function fmtMoney(cents, currency) {
    if (cents === null || cents === undefined || isNaN(Number(cents))) return "—";
    var cur = String(currency || "usd").toUpperCase();
    try {
      return esc(
        new Intl.NumberFormat("en-US", { style: "currency", currency: cur }).format(
          Number(cents) / 100
        )
      );
    } catch (e) {
      return esc("$" + (Number(cents) / 100).toFixed(2));
    }
  }

  function fmtInt(n) {
    if (n === null || n === undefined || isNaN(Number(n))) return "—";
    return esc(Number(n).toLocaleString("en-US"));
  }

  // dollars-text → integer cents (null when invalid)
  function parseMoney(v) {
    var n = Number(String(v).replace(/[$,\s]/g, ""));
    if (!isFinite(n) || n <= 0) return null;
    return Math.round(n * 100);
  }

  var PILL_TONES = {
    new: "violet",
    captured: "violet",
    active: "green",
    paid: "green",
    sent: "green",
    contacted: "green",
    received: "green",
    converted: "green",
    healthy: "green",
    attention: "amber",
    pending: "amber",
    open: "amber",
    past_due: "amber",
    trialing: "amber",
    removed: "red",
    failed: "red",
    canceled: "red",
    cancelled: "red",
    disabled: "red",
    uncollectible: "red",
  };

  function pill(status) {
    if (!status) return "—";
    var tone = PILL_TONES[String(status).toLowerCase()] || "grey";
    return (
      '<span class="p-pill is-' + tone + '">' +
      esc(String(status).replace(/_/g, " ")) +
      "</span>"
    );
  }

  // tolerate both {items,total} and bare arrays
  function listItems(res) {
    if (res && Array.isArray(res.items)) return res.items;
    if (Array.isArray(res)) return res;
    return [];
  }

  function listTotal(res, items) {
    return res && res.total != null ? Number(res.total) : items.length;
  }

  // quiet trend chip: +12% / −8% / ±0% / "new"; empty when unknowable
  function delta(cur, prev, title) {
    if (cur == null || prev == null) return "";
    cur = Number(cur);
    prev = Number(prev);
    if (isNaN(cur) || isNaN(prev)) return "";
    var cls, text;
    if (prev === 0 && cur === 0) return "";
    if (prev === 0) {
      cls = "up";
      text = "new";
    } else {
      var pct = Math.round(((cur - prev) / prev) * 100);
      cls = pct > 0 ? "up" : pct < 0 ? "down" : "flat";
      text = (pct > 0 ? "+" : pct < 0 ? "−" : "±") + Math.abs(pct) + "%";
    }
    return (
      '<span class="p-delta ' + cls + '"' +
      (title ? ' title="' + esc(title) + '"' : "") + ">" + esc(text) + "</span>"
    );
  }

  // range + prev/next controls; hidden while everything fits on one page
  function pager(pageKey, page, shown, total) {
    if (total <= PAGE_SIZE && page === 0) return "";
    var from = total === 0 ? 0 : page * PAGE_SIZE + 1;
    var to = page * PAGE_SIZE + shown;
    return (
      '<div class="p-pager"><span class="range">' +
      fmtInt(from) + "–" + fmtInt(to) + " of " + fmtInt(total) + "</span>" +
      '<div class="p-pager-btns">' +
      '<button class="btn btn-ghost btn-sm" type="button" data-action="page" data-key="' +
      esc(pageKey) + '" data-dir="-1"' + (page === 0 ? " disabled" : "") + ">← Prev</button>" +
      '<button class="btn btn-ghost btn-sm" type="button" data-action="page" data-key="' +
      esc(pageKey) + '" data-dir="1"' + (to >= total ? " disabled" : "") + ">Next →</button>" +
      "</div></div>"
    );
  }

  function bindPager() {
    bind("page", function (el) {
      var key = el.getAttribute("data-key");
      var dir = Number(el.getAttribute("data-dir"));
      if (!(key in state)) return;
      state[key] = Math.max(0, state[key] + dir);
      render();
    });
  }

  // "" → null, else a non-negative integer (undefined = invalid)
  function parseCount(v) {
    v = String(v == null ? "" : v).trim();
    if (v === "") return null;
    var n = Number(v);
    if (!Number.isInteger(n) || n < 0) return undefined;
    return n;
  }

  // GET /admin/orgs/{id} → {org,members,subscription,invoices,payments};
  // degrade gracefully if the org fields ever arrive flat
  function normalizeDetail(res) {
    res = res || {};
    return {
      org: res.org || res,
      members: Array.isArray(res.members) ? res.members : [],
      subscription: res.subscription || null,
      invoices: Array.isArray(res.invoices) ? res.invoices : [],
      payments: Array.isArray(res.payments) ? res.payments : [],
    };
  }

  function genPassword(len) {
    var chars =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"; // 64 chars: no modulo bias
    var buf = new Uint8Array(len);
    crypto.getRandomValues(buf);
    var out = "";
    for (var i = 0; i < len; i++) out += chars[buf[i] & 63];
    return out;
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy") ? resolve() : reject();
      } catch (e) {
        reject(e);
      }
      ta.remove();
    });
  }

  /* ---------- api ---------- */

  function api(path, opts) {
    opts = opts || {};
    var headers = {};
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    var token = getToken();
    if (token && !opts.noAuth) headers["Authorization"] = "Bearer " + token;

    return fetch(API_BASE + path, {
      method: opts.method || "GET",
      headers: headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    }).then(
      function (res) {
        return res.text().then(function (text) {
          var data = null;
          try { data = text ? JSON.parse(text) : null; } catch (e) { /* non-JSON */ }

          // central 401: session gone → back to login
          if (res.status === 401 && !opts.noAuth) {
            clearSession();
            if (location.hash !== "#/login") location.hash = "#/login";
            throw { status: 401, message: "Session expired — please sign in again." };
          }

          if (!res.ok) {
            var msg =
              (data && typeof data.detail === "string" && data.detail) ||
              (data && data.detail && JSON.stringify(data.detail)) ||
              res.statusText ||
              "Request failed";
            throw { status: res.status, message: msg };
          }
          return data;
        });
      },
      function () {
        throw { status: 0, message: "Cannot reach the backend at " + API_BASE + "." };
      }
    );
  }

  /* ---------- view + delegated actions ---------- */

  var actionMap = {}; // view-scoped [data-action] handlers, reset on each render

  function view(html) {
    actionMap = {};
    viewEl.innerHTML = html;
    window.scrollTo(0, 0);
  }

  function bind(name, fn) {
    actionMap[name] = fn;
  }

  var GLOBAL_ACTIONS = {
    logout: function () {
      api("/auth/admin/logout", { method: "POST" }).catch(function () {});
      clearSession();
      goto("#/login");
    },
    retry: function () {
      render();
    },
    nav: function (el) {
      goto(el.getAttribute("data-href"));
    },
    copy: function (el, e) {
      if (e) e.stopPropagation();
      var value = el.getAttribute("data-copy") || "";
      copyText(value).then(
        function () { toast("Copied.", "green"); },
        function () { toast("Copy failed — select it manually.", "red"); }
      );
    },
  };

  document.addEventListener("click", function (e) {
    var el = e.target.closest("[data-action]");
    if (!el) return;
    var fn = actionMap[el.getAttribute("data-action")] || GLOBAL_ACTIONS[el.getAttribute("data-action")];
    if (!fn) return;
    e.preventDefault();
    fn(el, e);
  });

  // keyboard activation for non-native controls (clickable table rows
  // carry data-action + tabindex; buttons/links never get tabindex here)
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Enter" && e.key !== " ") return;
    var el = e.target;
    if (!el || !el.hasAttribute || !el.hasAttribute("data-action") || !el.hasAttribute("tabindex")) return;
    var fn = actionMap[el.getAttribute("data-action")] || GLOBAL_ACTIONS[el.getAttribute("data-action")];
    if (!fn) return;
    e.preventDefault();
    fn(el, e);
  });

  function loading() {
    var rows = "";
    for (var i = 0; i < 5; i++) rows += '<div class="p-skeleton-row"></div>';
    view(
      '<div class="p-skeleton" role="status" aria-label="Loading">' +
        '<div class="p-skeleton-head"></div>' +
        '<div class="p-skeleton-table">' + rows + "</div>" +
        "</div>"
    );
  }

  function errorView(err) {
    view(
      '<div class="p-panel p-error-panel"><h2>Something went wrong</h2><p>' +
        esc((err && err.message) || "Request failed.") +
        '</p><button class="btn btn-ghost btn-sm" type="button" data-action="retry">Try again</button></div>'
    );
  }

  /* ---------- toasts ---------- */

  function toast(msg, tone) {
    var el = document.createElement("div");
    el.className = "p-toast" + (tone ? " is-" + tone : "");
    el.textContent = msg; // textContent: no HTML injection possible
    toastMount.appendChild(el);
    requestAnimationFrame(function () {
      el.classList.add("show");
    });
    setTimeout(function () {
      el.classList.remove("show");
      setTimeout(function () { el.remove(); }, 200);
    }, 4200);
  }

  /* ---------- modals ---------- */

  var activeModal = null;
  var modalReturnFocus = null; // element to refocus when the modal closes

  function openModal(html) {
    closeModal();
    modalReturnFocus = document.activeElement;
    var backdrop = document.createElement("div");
    backdrop.className = "p-modal-backdrop";
    backdrop.innerHTML =
      '<div class="p-modal" role="dialog" aria-modal="true">' + html + "</div>";
    backdrop.addEventListener("mousedown", function (e) {
      if (e.target === backdrop) closeModal();
    });
    modalMount.appendChild(backdrop);
    activeModal = backdrop;
    var first = backdrop.querySelector("input, select, textarea, button");
    if (first) first.focus();
    return backdrop.firstElementChild;
  }

  function closeModal() {
    if (activeModal) {
      var closing = activeModal;
      activeModal = null;
      // soft exit: play the .closing animation, then remove
      closing.classList.add("closing");
      setTimeout(function () { closing.remove(); }, 160);
      if (modalReturnFocus && modalReturnFocus.focus && document.contains(modalReturnFocus)) {
        try { modalReturnFocus.focus(); } catch (e) { /* detached */ }
      }
      modalReturnFocus = null;
    }
  }

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      if (activeModal) {
        closeModal();
        return;
      }
      // no modal open: collapse any expanded detail rows
      viewEl.querySelectorAll("tr.p-expand:not([hidden])").forEach(function (row) {
        row.hidden = true;
        var trigger = row.previousElementSibling;
        if (trigger) trigger.setAttribute("aria-expanded", "false");
      });
    }

    // "/" jumps to the view's search input (like every serious tool)
    if (e.key === "/" && !activeModal) {
      var t = e.target;
      var typing =
        t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT");
      if (!typing) {
        var search = viewEl.querySelector('.p-inline-input[type="search"]');
        if (search) {
          e.preventDefault();
          search.focus();
          search.select();
        }
      }
    }
  });

  // promise-aware confirm dialog; title/body are escaped here, pass raw strings
  function confirmModal(opts) {
    return new Promise(function (resolve) {
      var m = openModal(
        "<h2>" + esc(opts.title) + "</h2>" +
          (opts.body ? "<p>" + esc(opts.body) + "</p>" : "") +
          '<div class="p-modal-actions">' +
          '<button class="btn btn-ghost btn-sm" type="button" data-x="cancel">Cancel</button>' +
          '<button class="btn btn-sm ' +
          (opts.danger ? "p-btn-danger" : "btn-primary") +
          '" type="button" data-x="ok">' +
          esc(opts.confirmLabel || "Confirm") +
          "</button></div>"
      );
      m.querySelector('[data-x="cancel"]').addEventListener("click", function () {
        closeModal();
        resolve(false);
      });
      m.querySelector('[data-x="ok"]').addEventListener("click", function () {
        closeModal();
        resolve(true);
      });
    });
  }

  /* ---------- router ---------- */

  var ROUTES = [
    { re: /^#\/login$/, nav: null, handler: viewLogin, isPublic: true, isLogin: true },
    { re: /^#\/$/, nav: "overview", handler: viewOverview },
    { re: /^#\/demos$/, nav: "demos", handler: viewDemos },
    { re: /^#\/demos\/([^\/]+)$/, nav: "demos", handler: viewDemoDetail },
    { re: /^#\/orgs$/, nav: "orgs", handler: viewOrgs },
    { re: /^#\/orgs\/new$/, nav: "orgs", handler: viewOrgNew },
    { re: /^#\/orgs\/([^\/]+)$/, nav: "orgs", handler: viewOrgDetail },
    { re: /^#\/orgs\/([^\/]+)\/billing$/, nav: "orgs", handler: viewBilling },
    { re: /^#\/audit$/, nav: "audit", handler: viewAudit },
    { re: /^#\/outbox$/, nav: "outbox", handler: viewOutbox },
  ];

  function goto(hash) {
    if (location.hash === hash) render();
    else location.hash = hash;
  }

  function render() {
    closeModal();
    var hash = location.hash || "#/";
    if (hash === "#") hash = "#/";

    var route = null;
    var match = null;
    for (var i = 0; i < ROUTES.length; i++) {
      match = hash.match(ROUTES[i].re);
      if (match) { route = ROUTES[i]; break; }
    }
    if (!route) { goto("#/"); return; }

    var token = getToken();
    if (!route.isPublic && !token) { goto("#/login"); return; }
    if (route.isLogin && token) { goto("#/"); return; }

    // chrome: sidebar visibility, signed-in email, active nav item
    document.body.classList.toggle("p-login", !!route.isLogin);
    var email = "";
    try { email = sessionStorage.getItem(EMAIL_KEY) || ""; } catch (e) {}
    emailEl.textContent = email;
    document.querySelectorAll(".p-tabs a").forEach(function (a) {
      a.classList.toggle("active", a.getAttribute("data-nav") === route.nav);
    });

    var params = [];
    for (var p = 1; p < match.length; p++) params.push(decodeURIComponent(match[p]));
    route.handler.apply(null, params);
  }

  window.addEventListener("hashchange", render);

  /* ---------- view: login ---------- */

  function viewLogin() {
    view(
      '<div class="p-login-wrap"><div class="p-login-panel">' +
        '<span class="nav-logo">' + LOGO_SVG + "Sightline</span>" +
        '<span class="tag">Admin portal</span>' +
        "<h1>Sign in</h1>" +
        '<form id="lg-form" novalidate>' +
        '<div class="field"><label for="lg-email">Email</label>' +
        '<input id="lg-email" type="email" autocomplete="username" required /></div>' +
        '<div class="field"><label for="lg-password">Password</label>' +
        '<input id="lg-password" type="password" autocomplete="current-password" required /></div>' +
        '<p class="p-form-err" id="lg-err" hidden></p>' +
        '<button class="btn btn-primary" type="submit" id="lg-go" style="width:100%; justify-content:center;">Sign in</button>' +
        "</form>" +
        '<p class="p-note" style="margin-top:16px; text-align:center;">Restricted to Sightline staff.</p>' +
        "</div></div>"
    );

    var form = document.getElementById("lg-form");
    var errEl = document.getElementById("lg-err");
    var btn = document.getElementById("lg-go");

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var email = document.getElementById("lg-email").value.trim();
      var password = document.getElementById("lg-password").value;
      errEl.hidden = true;
      if (!email || !password) {
        errEl.textContent = "Enter your email and password.";
        errEl.hidden = false;
        return;
      }
      btn.disabled = true;
      btn.textContent = "Signing in…";
      api("/auth/admin/login", {
        method: "POST",
        body: { email: email, password: password },
        noAuth: true,
      })
        .then(function (res) {
          setSession(res.token, res.admin && res.admin.email);
          goto("#/");
        })
        .catch(function (err) {
          btn.disabled = false;
          btn.textContent = "Sign in";
          errEl.textContent =
            err.status === 401 ? "Invalid email or password." : err.message;
          errEl.hidden = false;
        });
    });
  }

  /* ---------- view: overview ---------- */

  function viewOverview() {
    loading();
    Promise.all([
      api("/admin/overview"),
      api("/admin/audit-log?limit=5").catch(function () { return { items: [] }; }),
    ])
      .then(function (res) {
        var o = res[0] || {};
        var audit = listItems(res[1]);

        var auditRows = audit
          .map(function (a) {
            return (
              "<tr><td>" + fmtDateTime(a.created_at) + "</td>" +
              "<td>" + esc(a.actor_id || a.actor_type || "—") + "</td>" +
              '<td class="strong">' + esc(a.action) + "</td>" +
              "<td>" + esc(a.org_name || "—") + "</td></tr>"
            );
          })
          .join("");

        // the two numbers an operator acts on lead the strip, a step larger;
        // counts that demand attention pick up their signal color
        var demoTone = Number(o.demo_requests_new) > 0 ? "is-accent" : "";
        var invTone = Number(o.invoices_open) > 0 ? "is-amber" : "";
        var mrrDelta = delta(o.mrr_cents, o.mrr_prev_cents, "vs 7 days ago");
        var demoDelta = delta(
          o.demo_requests_7d,
          o.demo_requests_prev_7d,
          "submissions — this week vs last"
        );

        // needs-attention rows: only what is actually wrong, as rows not cards
        var attn = o.attention || null;
        var attnRows = "";
        if (attn) {
          if (Number(attn.untriaged_demos) > 0) {
            attnRows +=
              '<div class="p-attn-row"><span><strong>' + fmtInt(attn.untriaged_demos) +
              "</strong> untriaged demo request" + (Number(attn.untriaged_demos) === 1 ? "" : "s") +
              '</span><a class="p-back" style="margin:0;" href="#/demos" data-action="attn-demos">Review →</a></div>';
          }
          if (Number(attn.failed_outbox) > 0) {
            attnRows +=
              '<div class="p-attn-row"><span><strong>' + fmtInt(attn.failed_outbox) +
              "</strong> failed email" + (Number(attn.failed_outbox) === 1 ? "" : "s") +
              '</span><a class="p-back" style="margin:0;" href="#/outbox" data-action="attn-outbox">Retry →</a></div>';
          }
          if (Number(attn.overdue_invoices) > 0) {
            attnRows +=
              '<div class="p-attn-row"><span><strong>' + fmtInt(attn.overdue_invoices) +
              "</strong> overdue invoice" + (Number(attn.overdue_invoices) === 1 ? "" : "s") +
              "</span></div>";
          }
          (attn.orgs_without_subscription || []).forEach(function (org) {
            attnRows +=
              '<div class="p-attn-row"><span><strong>' + esc(org.name) +
              '</strong> has no subscription</span><a class="p-back" style="margin:0;" href="#/orgs/' +
              esc(encodeURIComponent(org.id)) + '/billing">Set up →</a></div>';
          });
          var more =
            Number(attn.orgs_without_subscription_total || 0) -
            (attn.orgs_without_subscription || []).length;
          if (more > 0) {
            attnRows +=
              '<div class="p-attn-row"><span>' + fmtInt(more) +
              ' more without a subscription</span><a class="p-back" style="margin:0;" href="#/orgs">All orgs →</a></div>';
          }
        }

        view(
          '<div class="p-head"><div><h1>Overview</h1>' +
            '<p class="p-sub">Sightline back office</p></div></div>' +
            '<div class="p-kpis">' +
            kpi(null, fmtMoney(o.mrr_cents), "MRR " + mrrDelta, "is-primary", "") +
            kpi("#/demos", fmtInt(o.demo_requests_new), "New demo requests " + demoDelta, "is-primary", demoTone) +
            kpi("#/orgs", fmtInt(o.orgs_active), "Active orgs", "", "") +
            kpi(null, fmtInt(o.invoices_open), "Open invoices", "", invTone) +
            kpi("#/outbox", fmtInt(o.outbox_captured), "Captured emails", "", "") +
            "</div>" +
            (attn
              ? '<div class="p-section"><div class="p-section-head"><h2>Needs attention</h2></div>' +
                '<div class="p-panel p-attn">' +
                (attnRows ||
                  '<div class="p-attn-clear"><span class="p-pill is-green">all clear</span>' +
                  " Nothing needs attention right now.</div>") +
                "</div></div>"
              : "") +
            '<div class="p-section"><div class="p-section-head"><h2>Recent activity</h2>' +
            '<a class="p-back" style="margin:0;" href="#/audit">View all →</a></div>' +
            '<div class="p-table-wrap"><table class="p-table"><thead><tr>' +
            "<th>Time</th><th>Actor</th><th>Action</th><th>Organization</th>" +
            "</tr></thead><tbody>" +
            (audit.length
              ? auditRows
              : '<tr class="p-empty-row"><td colspan="4">Nothing in the audit log yet.</td></tr>') +
            "</tbody></table></div></div>"
        );

        // attention links pre-set the destination view's filter
        bind("attn-demos", function () {
          state.demoStatus = "new";
          state.demoPage = 0;
          goto("#/demos");
        });
        bind("attn-outbox", function () {
          state.outboxStatus = "failed";
          state.outboxPage = 0;
          goto("#/outbox");
        });
      })
      .catch(errorView);
  }

  // lbl is trusted markup: static literals plus delta() (which escapes
  // internally). Never pass server data through it unescaped.
  function kpi(href, num, lbl, cls, numCls) {
    var inner =
      '<div class="num' + (numCls ? " " + numCls : "") + '">' + num +
      '</div><div class="lbl">' + lbl + "</div>";
    var className = "p-kpi" + (cls ? " " + cls : "");
    return href
      ? '<a class="' + className + '" href="' + esc(href) + '">' + inner + "</a>"
      : '<div class="' + className + '">' + inner + "</div>";
  }

  /* ---------- view: demo requests ---------- */

  var DEMO_FILTERS = [
    { v: "", label: "All" },
    { v: "new", label: "New" },
    { v: "contacted", label: "Contacted" },
    { v: "archived", label: "Archived" },
    { v: "converted", label: "Converted" },
  ];

  function viewDemos() {
    loading();
    var qs =
      "?limit=" + PAGE_SIZE + "&offset=" + state.demoPage * PAGE_SIZE +
      (state.demoStatus ? "&status=" + encodeURIComponent(state.demoStatus) : "");
    api("/admin/demo-requests" + qs)
      .then(function (res) {
        var rows = listItems(res);
        var total = listTotal(res, rows);

        var chips = DEMO_FILTERS.map(function (f) {
          return (
            '<button class="p-chip' + (state.demoStatus === f.v ? " active" : "") +
            '" type="button" data-action="demo-filter" data-v="' + esc(f.v) + '">' +
            esc(f.label) + "</button>"
          );
        }).join("");

        var body = rows
          .map(function (r) {
            return (
              '<tr class="is-click" tabindex="0" data-action="nav" data-href="#/demos/' +
              esc(encodeURIComponent(r.id)) + '">' +
              "<td>" + fmtDateTime(r.created_at) + "</td>" +
              '<td class="strong">' + esc(r.name) +
              '<div class="p-note">' + esc(r.email) + "</div></td>" +
              "<td>" + esc(r.company || "—") + "</td>" +
              "<td>" + esc(r.kind || "demo") + "</td>" +
              "<td>" + pill(r.status) + "</td></tr>"
            );
          })
          .join("");

        view(
          '<div class="p-head"><div><h1>Demo requests</h1>' +
            '<p class="p-sub">' + fmtInt(total) +
            (state.demoStatus ? " " + esc(state.demoStatus) : " total") + "</p></div>" +
            '<div class="p-chips">' + chips + "</div></div>" +
            '<div class="p-table-wrap"><table class="p-table"><thead><tr>' +
            "<th>Received</th><th>Name</th><th>Company</th><th>Kind</th><th>Status</th>" +
            "</tr></thead><tbody>" +
            (rows.length
              ? body
              : '<tr class="p-empty-row"><td colspan="5">' +
                esc(
                  state.demoStatus
                    ? "No " + state.demoStatus + " requests."
                    : "No demo requests yet. Submissions from the marketing demo form land here."
                ) +
                "</td></tr>") +
            "</tbody></table></div>" +
            pager("demoPage", state.demoPage, rows.length, total)
        );

        bind("demo-filter", function (el) {
          state.demoStatus = el.getAttribute("data-v") || "";
          state.demoPage = 0;
          render();
        });
        bindPager();
      })
      .catch(errorView);
  }

  /* ---------- view: demo request detail ---------- */

  function viewDemoDetail(id) {
    loading();
    api("/admin/demo-requests/" + encodeURIComponent(id))
      .then(function (r) {
        if (!r || !r.id) {
          view(
            '<a class="p-back" href="#/demos">← Demo requests</a>' +
              '<div class="p-panel p-error-panel"><h2>Not found</h2>' +
              "<p>This request no longer exists.</p></div>"
          );
          return;
        }

        var converted = String(r.status) === "converted";

        var triage = converted
          ? ""
          : ["new", "contacted", "archived"]
              .map(function (s) {
                var current = String(r.status) === s;
                return (
                  '<button class="btn btn-ghost btn-sm" type="button" data-action="triage" data-s="' +
                  esc(s) + '"' + (current ? " disabled" : "") + ">" +
                  esc(s === "new" ? "Mark new" : s === "contacted" ? "Mark contacted" : "Archive") +
                  "</button>"
                );
              })
              .join("") +
            '<button class="btn btn-primary btn-sm" type="button" data-action="convert">Convert to organization</button>';

        // only show the fields this kind of request actually carries —
        // a contact message has a topic, a demo request has lot details
        var isContact = String(r.kind) === "contact";
        var factCells =
          '<div><div class="k">Email</div><div class="v"><a href="mailto:' +
          esc(r.email) + '">' + esc(r.email) + "</a></div></div>";
        if (isContact) {
          factCells +=
            '<div><div class="k">Topic</div><div class="v">' + esc(r.topic || "—") + "</div></div>";
        } else {
          factCells +=
            '<div><div class="k">Company</div><div class="v">' + esc(r.company || "—") + "</div></div>" +
            '<div><div class="k">Lot size</div><div class="v">' + esc(r.lot_size || "—") + "</div></div>" +
            '<div><div class="k">Cameras</div><div class="v">' + esc(r.cameras || "—") + "</div></div>";
        }

        view(
          '<a class="p-back" href="#/demos">← Demo requests</a>' +
            '<div class="p-head"><div><h1>' + esc(r.name) + "</h1>" +
            '<p class="p-sub">' + esc(r.kind || "demo") + " request · " + fmtDateTime(r.created_at) + "</p></div>" +
            '<div class="p-head-actions">' + pill(r.status) + triage + "</div></div>" +
            (converted
              ? '<div class="p-banner is-green"><strong>Converted</strong>' +
                "<span>This request became " +
                (r.converted_org_id
                  ? '<a href="#/orgs/' + esc(encodeURIComponent(r.converted_org_id)) +
                    '" style="text-decoration:underline;">an organization</a>.'
                  : "an organization.") +
                "</span></div>"
              : "") +
            '<div class="p-panel"><div class="p-detail-grid">' +
            factCells +
            '<div style="grid-column:1/-1;"><div class="k">Message</div><div class="v p-msg">' +
            esc(r.message || "—") + "</div></div>" +
            "</div>" +
            '<div class="p-meta-line">Request ' + idChip(r.id) + "</div></div>"
        );

        bind("convert", function () {
          openConvertModal(r);
        });

        bind("triage", function (el) {
          var s = el.getAttribute("data-s");
          var label = el.textContent;
          el.disabled = true;
          el.textContent = "Saving…";
          api("/admin/demo-requests/" + encodeURIComponent(r.id), {
            method: "PATCH",
            body: { status: s },
          })
            .then(function () {
              toast("Marked " + s + ".", "green");
              render();
            })
            .catch(function (err) {
              el.disabled = false;
              el.textContent = label;
              toast(err.message, "red");
            });
        });
      })
      .catch(errorView);
  }

  /* ---------- modal: convert demo request → organization ---------- */

  function openConvertModal(r) {
    api("/admin/plans")
      .catch(function () { return { items: [] }; })
      .then(function (res) {
        var plans = listItems(res).filter(function (p) { return p.active !== false; });
        var planOpts =
          '<option value="">No trial subscription</option>' +
          plans
            .map(function (p) {
              return (
                '<option value="' + esc(p.id) + '">Trial of ' + esc(p.name) + " — " +
                fmtMoney(p.amount_cents, p.currency) + " / " + esc(p.interval || "month") +
                "</option>"
              );
            })
            .join("");

        var m = openModal(
          "<h2>Convert to organization</h2>" +
            '<p style="margin-bottom:16px;">Creates a customer record from this request and links the two.</p>' +
            '<form id="cv-form" novalidate>' +
            '<div class="field"><label for="cv-name">Organization name</label>' +
            '<input id="cv-name" type="text" required value="' + esc(r.company || r.name || "") + '" /></div>' +
            '<div class="field"><label for="cv-email">Contact email</label>' +
            '<input id="cv-email" type="email" value="' + esc(r.email || "") + '" /></div>' +
            '<div class="field"><label for="cv-plan">Subscription</label>' +
            '<select id="cv-plan">' + planOpts + "</select></div>" +
            '<p class="p-form-err" id="cv-err" hidden></p>' +
            '<div class="p-modal-actions">' +
            '<button class="btn btn-ghost btn-sm" type="button" data-x="cancel">Cancel</button>' +
            '<button class="btn btn-primary btn-sm" type="submit" id="cv-go">Convert</button>' +
            "</div></form>"
        );

        var errEl = m.querySelector("#cv-err");
        m.querySelector('[data-x="cancel"]').addEventListener("click", closeModal);

        m.querySelector("#cv-form").addEventListener("submit", function (e) {
          e.preventDefault();
          errEl.hidden = true;
          var name = m.querySelector("#cv-name").value.trim();
          if (!name) {
            errEl.textContent = "Give the organization a name.";
            errEl.hidden = false;
            return;
          }
          var btn = m.querySelector("#cv-go");
          btn.disabled = true;
          btn.textContent = "Converting…";
          api("/admin/demo-requests/" + encodeURIComponent(r.id) + "/convert", {
            method: "POST",
            body: {
              name: name,
              contact_email: m.querySelector("#cv-email").value.trim() || null,
              plan_id: m.querySelector("#cv-plan").value || null,
            },
          })
            .then(function (res) {
              closeModal();
              var orgId = res && res.org && res.org.id;
              toast("Converted to organization.", "green");
              goto(orgId ? "#/orgs/" + encodeURIComponent(orgId) : "#/orgs");
            })
            .catch(function (err) {
              btn.disabled = false;
              btn.textContent = "Convert";
              errEl.textContent = err.message;
              errEl.hidden = false;
            });
        });
      });
  }

  /* ---------- view: organizations ---------- */

  function viewOrgs() {
    loading();
    var qs = "?limit=" + PAGE_SIZE + "&offset=" + state.orgsPage * PAGE_SIZE;
    if (!state.showRemoved) qs += "&status=active";
    if (state.orgQuery) qs += "&q=" + encodeURIComponent(state.orgQuery);

    api("/admin/orgs" + qs)
      .then(function (res) {
        var rows = listItems(res);
        var total = listTotal(res, rows);

        var body = rows
          .map(function (o) {
            return (
              '<tr class="is-click" tabindex="0" data-action="nav" data-href="#/orgs/' +
              esc(encodeURIComponent(o.id)) + '">' +
              '<td class="strong">' + esc(o.name) + "</td>" +
              "<td>" + esc(o.contact_email || "—") + "</td>" +
              '<td class="num">' + fmtInt(o.member_count) + "</td>" +
              "<td>" + subSummary(o.subscription) + "</td>" +
              "<td>" + pill(o.status) + "</td>" +
              "<td>" + fmtDate(o.created_at) + "</td></tr>"
            );
          })
          .join("");

        view(
          '<div class="p-head"><div><h1>Organizations</h1>' +
            '<p class="p-sub">' + fmtInt(total) +
            (state.showRemoved ? " total (incl. removed)" : " active") + "</p></div>" +
            '<div class="p-head-actions">' +
            '<form id="org-search" style="display:flex; gap:8px;">' +
            '<input class="p-inline-input" id="org-q" type="search" placeholder="Search name or email…" value="' +
            esc(state.orgQuery) + '" />' +
            "</form>" +
            '<label class="p-check"><input type="checkbox" id="org-removed"' +
            (state.showRemoved ? " checked" : "") + " /> Show removed</label>" +
            '<a class="btn btn-primary btn-sm" href="#/orgs/new">New organization</a>' +
            "</div></div>" +
            '<div class="p-table-wrap"><table class="p-table"><thead><tr>' +
            '<th>Name</th><th>Contact</th><th class="num">Members</th><th>Plan</th><th>Status</th><th>Created</th>' +
            "</tr></thead><tbody>" +
            (rows.length
              ? body
              : '<tr class="p-empty-row"><td colspan="6">' +
                esc(state.orgQuery ? "No organizations match that search." : "No organizations yet — create the first one.") +
                "</td></tr>") +
            "</tbody></table></div>" +
            pager("orgsPage", state.orgsPage, rows.length, total)
        );

        document.getElementById("org-search").addEventListener("submit", function (e) {
          e.preventDefault();
          state.orgQuery = document.getElementById("org-q").value.trim();
          state.orgsPage = 0;
          render();
        });
        document.getElementById("org-removed").addEventListener("change", function (e) {
          state.showRemoved = e.target.checked;
          state.orgsPage = 0;
          render();
        });
        bindPager();
      })
      .catch(errorView);
  }

  // org-list subscription summary — tolerant to whatever summary shape ships
  function subSummary(s) {
    if (!s) return "—";
    var name = s.plan_name || s.plan_code || (s.plan && s.plan.name) || "";
    var out = name ? esc(name) + " " : "";
    out += s.status ? pill(s.status) : "";
    return out || "—";
  }

  /* ---------- view: new organization ---------- */

  function viewOrgNew() {
    view(
      '<a class="p-back" href="#/orgs">← Organizations</a>' +
        '<div class="p-head"><div><h1>New organization</h1></div></div>' +
        '<div class="p-panel" style="max-width:560px;">' +
        '<form id="org-form" novalidate>' +
        '<div class="field"><label for="og-name">Name</label>' +
        '<input id="og-name" type="text" required placeholder="Acme Parking Co." /></div>' +
        '<div class="field"><label for="og-email">Contact email</label>' +
        '<input id="og-email" type="email" placeholder="ops@acme.com" /></div>' +
        '<div class="field"><label for="og-notes">Notes</label>' +
        '<textarea id="og-notes" rows="3" placeholder="Anything worth remembering about this customer…"></textarea></div>' +
        '<p class="p-form-err" id="og-err" hidden></p>' +
        '<div class="p-modal-actions" style="justify-content:flex-start;">' +
        '<button class="btn btn-primary btn-sm" type="submit" id="og-go">Create organization</button>' +
        '<a class="btn btn-ghost btn-sm" href="#/orgs">Cancel</a>' +
        "</div></form></div>"
    );

    var form = document.getElementById("org-form");
    var errEl = document.getElementById("og-err");
    var btn = document.getElementById("og-go");

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      errEl.hidden = true;
      var name = document.getElementById("og-name").value.trim();
      if (!name) {
        errEl.textContent = "Give the organization a name.";
        errEl.hidden = false;
        return;
      }
      btn.disabled = true;
      btn.textContent = "Creating…";
      api("/admin/orgs", {
        method: "POST",
        body: {
          name: name,
          contact_email: document.getElementById("og-email").value.trim() || null,
          notes: document.getElementById("og-notes").value.trim() || null,
        },
      })
        .then(function (res) {
          toast("Organization created.", "green");
          var id = (res && res.id) || (res && res.org && res.org.id);
          goto(id ? "#/orgs/" + encodeURIComponent(id) : "#/orgs");
        })
        .catch(function (err) {
          btn.disabled = false;
          btn.textContent = "Create organization";
          errEl.textContent = err.message;
          errEl.hidden = false;
        });
    });
  }

  /* ---------- view: organization detail ---------- */

  function viewOrgDetail(id) {
    loading();
    Promise.all([
      api("/admin/orgs/" + encodeURIComponent(id)),
      api("/admin/plans").catch(function () { return { items: [] }; }),
    ])
      .then(function (res) {
        var d = normalizeDetail(res[0]);
        var org = d.org;
        var sub = d.subscription;
        var planMap = {};
        listItems(res[1]).forEach(function (p) { planMap[String(p.id)] = p; });
        var removed = String(org.status) === "removed";
        var orgHash = esc(encodeURIComponent(org.id));

        var html = '<a class="p-back" href="#/orgs">← Organizations</a>';

        if (removed) {
          html +=
            '<div class="p-banner is-red"><strong>Removed</strong>' +
            "<span>This organization was removed " + fmtDateTime(org.removed_at) +
            ". Members cannot sign in and everything below is read-only.</span></div>";
        }

        html +=
          '<div class="p-head"><div><h1>' + esc(org.name) + "</h1>" +
          '<p class="p-sub">' + esc(org.contact_email || "no contact email") +
          " · created " + fmtDate(org.created_at) + "</p></div>" +
          '<div class="p-head-actions">' + pill(org.status) +
          '<a class="btn btn-ghost btn-sm" href="#/orgs/' + orgHash + '/billing">Billing →</a>' +
          "</div></div>";

        // deployment summary — counts recorded on the org, null = unknown;
        // health is computed server-side (unknown / attention / healthy)
        html +=
          '<div class="p-kpis is-mini" style="margin-bottom:24px;">' +
          kpi(null, org.sites_count != null ? fmtInt(org.sites_count) : "—", "Sites", "", "") +
          kpi(null, org.cameras_count != null ? fmtInt(org.cameras_count) : "—", "Cameras", "", "") +
          kpi(null, org.spaces_count != null ? fmtInt(org.spaces_count) : "—", "Spaces", "", "") +
          kpi(null, pill(org.health || "unknown"), "Health", "", "") +
          "</div>";

        // details + billing summary side by side
        html += '<div class="p-grid-2">';

        if (removed) {
          html +=
            '<div class="p-panel"><h2 style="margin-bottom:16px;">Details</h2>' +
            '<div class="p-detail-grid">' +
            '<div><div class="k">Name</div><div class="v">' + esc(org.name) + "</div></div>" +
            '<div><div class="k">Contact email</div><div class="v">' + esc(org.contact_email || "—") + "</div></div>" +
            '<div style="grid-column:1/-1;"><div class="k">Notes</div><div class="v p-msg">' + esc(org.notes || "—") + "</div></div>" +
            "</div>" +
            '<div class="p-meta-line">Organization ' + idChip(org.id) + "</div></div>";
        } else {
          html +=
            '<div class="p-panel"><h2 style="margin-bottom:16px;">Details</h2>' +
            '<form id="org-edit" novalidate>' +
            '<div class="field"><label for="oe-name">Name</label>' +
            '<input id="oe-name" type="text" required value="' + esc(org.name) + '" /></div>' +
            '<div class="field"><label for="oe-email">Contact email</label>' +
            '<input id="oe-email" type="email" value="' + esc(org.contact_email || "") + '" /></div>' +
            '<div class="p-form-row-3">' +
            '<div class="field"><label for="oe-sites">Sites</label>' +
            '<input id="oe-sites" type="number" min="0" step="1" inputmode="numeric" value="' +
            esc(org.sites_count != null ? org.sites_count : "") + '" /></div>' +
            '<div class="field"><label for="oe-cams">Cameras</label>' +
            '<input id="oe-cams" type="number" min="0" step="1" inputmode="numeric" value="' +
            esc(org.cameras_count != null ? org.cameras_count : "") + '" /></div>' +
            '<div class="field"><label for="oe-spaces">Spaces</label>' +
            '<input id="oe-spaces" type="number" min="0" step="1" inputmode="numeric" value="' +
            esc(org.spaces_count != null ? org.spaces_count : "") + '" /></div>' +
            "</div>" +
            '<div class="field"><label for="oe-notes">Notes</label>' +
            '<textarea id="oe-notes" rows="3">' + esc(org.notes || "") + "</textarea></div>" +
            '<p class="p-form-err" id="oe-err" hidden></p>' +
            '<button class="btn btn-ghost btn-sm" type="submit" id="oe-go">Save changes</button>' +
            "</form>" +
            '<div class="p-meta-line">Organization ' + idChip(org.id) + "</div></div>";
        }

        // billing summary card
        var planName = sub && planMap[String(sub.plan_id)] ? planMap[String(sub.plan_id)].name : null;
        var subHtml;
        if (sub) {
          subHtml =
            '<div class="p-detail-grid">' +
            '<div><div class="k">Plan</div><div class="v">' + esc(planName || sub.plan_id || "—") + "</div></div>" +
            '<div><div class="k">Status</div><div class="v">' + pill(sub.status) + "</div></div>" +
            '<div><div class="k">Current period</div><div class="v">' +
            fmtDate(sub.current_period_start) + " – " + fmtDate(sub.current_period_end) + "</div></div>" +
            (sub.canceled_at
              ? '<div><div class="k">Canceled</div><div class="v">' + fmtDate(sub.canceled_at) + "</div></div>"
              : "") +
            "</div>";
        } else {
          subHtml = '<p style="color:var(--text-3); font-style:italic;">No subscription yet.</p>';
        }
        html +=
          '<div class="p-panel"><div class="p-section-head" style="margin-bottom:16px;"><h2>Billing</h2>' +
          '<a class="p-back" style="margin:0;" href="#/orgs/' + orgHash + '/billing">Manage →</a></div>' +
          subHtml +
          '<p class="p-note" style="margin-top:16px;">' +
          fmtInt(d.invoices.length) + " recent invoice(s) · " + fmtInt(d.payments.length) + " recent payment(s)</p>" +
          "</div></div>";

        // members
        var memberRows = d.members
          .map(function (m) {
            return (
              "<tr>" +
              '<td class="strong">' + esc(m.email) + "</td>" +
              "<td>" + esc(m.full_name || "—") + "</td>" +
              "<td>" + esc(m.role || "member") + "</td>" +
              "<td>" + pill(m.status) + "</td>" +
              "<td>" + fmtDate(m.created_at) + "</td>" +
              (removed
                ? ""
                : '<td><div class="p-row-actions"><button class="btn btn-ghost btn-sm" type="button" ' +
                  'data-action="member-remove" data-id="' + esc(m.id) + '" data-email="' + esc(m.email) + '">Remove</button></div></td>') +
              "</tr>"
            );
          })
          .join("");

        html +=
          '<div class="p-section"><div class="p-section-head"><h2>Members</h2>' +
          (removed
            ? ""
            : '<button class="btn btn-primary btn-sm" type="button" data-action="member-add">Add member</button>') +
          "</div>" +
          '<div class="p-table-wrap"><table class="p-table"><thead><tr>' +
          "<th>Email</th><th>Name</th><th>Role</th><th>Status</th><th>Added</th>" +
          (removed ? "" : "<th></th>") +
          "</tr></thead><tbody>" +
          (d.members.length
            ? memberRows
            : '<tr class="p-empty-row"><td colspan="' + (removed ? 5 : 6) +
              '">No members yet — add the first login.</td></tr>') +
          "</tbody></table></div>" +
          "</div>";

        // danger zone
        if (!removed) {
          html +=
            '<div class="p-section p-danger-zone"><div><h3>Remove customer</h3>' +
            "<p>Cancels the subscription, signs every member out immediately, blocks future logins, and notifies members by email.</p></div>" +
            '<button class="btn btn-sm p-btn-danger" type="button" data-action="org-remove">Remove customer…</button></div>';
        }

        view(html);

        /* -- bindings -- */

        if (!removed) {
          document.getElementById("org-edit").addEventListener("submit", function (e) {
            e.preventDefault();
            var errEl = document.getElementById("oe-err");
            var btn = document.getElementById("oe-go");
            errEl.hidden = true;
            var name = document.getElementById("oe-name").value.trim();
            if (!name) {
              errEl.textContent = "The organization needs a name.";
              errEl.hidden = false;
              return;
            }
            var sites = parseCount(document.getElementById("oe-sites").value);
            var cams = parseCount(document.getElementById("oe-cams").value);
            var spaces = parseCount(document.getElementById("oe-spaces").value);
            if (sites === undefined || cams === undefined || spaces === undefined) {
              errEl.textContent = "Sites, cameras and spaces must be whole numbers (or left blank).";
              errEl.hidden = false;
              return;
            }
            btn.disabled = true;
            btn.textContent = "Saving…";
            api("/admin/orgs/" + encodeURIComponent(org.id), {
              method: "PATCH",
              body: {
                name: name,
                contact_email: document.getElementById("oe-email").value.trim() || null,
                notes: document.getElementById("oe-notes").value.trim() || null,
                sites_count: sites,
                cameras_count: cams,
                spaces_count: spaces,
              },
            })
              .then(function () {
                toast("Saved.", "green");
                render();
              })
              .catch(function (err) {
                btn.disabled = false;
                btn.textContent = "Save changes";
                errEl.textContent = err.message;
                errEl.hidden = false;
              });
          });

          bind("member-add", function () {
            openAddMemberModal(org);
          });

          bind("member-remove", function (el) {
            var mid = el.getAttribute("data-id");
            var email = el.getAttribute("data-email");
            confirmModal({
              title: "Remove " + email + "?",
              body: "Their sessions are revoked immediately and they can no longer log in.",
              confirmLabel: "Remove member",
              danger: true,
            }).then(function (yes) {
              if (!yes) return;
              var label = el.textContent;
              el.disabled = true;
              el.textContent = "Removing…";
              api("/admin/members/" + encodeURIComponent(mid), { method: "DELETE" })
                .then(function () {
                  toast("Member removed.", "green");
                  render();
                })
                .catch(function (err) {
                  el.disabled = false;
                  el.textContent = label;
                  toast(err.message, "red");
                });
            });
          });

          bind("org-remove", function () {
            openRemoveCustomerModal(org);
          });
        }
      })
      .catch(errorView);
  }

  /* ---------- modal: add member ---------- */

  function openAddMemberModal(org) {
    var m = openModal(
      "<h2>Add member</h2>" +
        '<p style="margin-bottom:16px;">A login for ' + esc(org.name) + "'s dashboard.</p>" +
        '<form id="am-form" novalidate>' +
        '<div class="field"><label for="am-email">Email</label>' +
        '<input id="am-email" type="email" required placeholder="alex@company.com" /></div>' +
        '<div class="field"><label for="am-name">Full name</label>' +
        '<input id="am-name" type="text" placeholder="Alex Rivera" /></div>' +
        '<div class="field"><label for="am-role">Role</label>' +
        '<select id="am-role"><option value="member" selected>member</option><option value="admin">admin</option></select></div>' +
        '<div class="field"><label for="am-pw">Password</label>' +
        '<div class="p-pw-row">' +
        '<input id="am-pw" type="text" autocomplete="new-password" required spellcheck="false" />' +
        '<button class="btn btn-ghost btn-sm" type="button" id="am-gen">Generate</button>' +
        '<button class="btn btn-ghost btn-sm" type="button" id="am-copy">Copy</button>' +
        "</div>" +
        '<p class="p-note" style="margin-top:8px;">Save it now — the password is never shown again.</p></div>' +
        '<p class="p-form-err" id="am-err" hidden></p>' +
        '<div class="p-modal-actions">' +
        '<button class="btn btn-ghost btn-sm" type="button" data-x="cancel">Cancel</button>' +
        '<button class="btn btn-primary btn-sm" type="submit" id="am-go">Add member</button>' +
        "</div></form>"
    );

    var errEl = m.querySelector("#am-err");
    var pw = m.querySelector("#am-pw");

    m.querySelector('[data-x="cancel"]').addEventListener("click", closeModal);

    m.querySelector("#am-gen").addEventListener("click", function () {
      pw.value = genPassword(20);
      pw.focus();
      pw.select();
    });

    m.querySelector("#am-copy").addEventListener("click", function () {
      if (!pw.value) { toast("Nothing to copy yet.", "red"); return; }
      copyText(pw.value).then(
        function () { toast("Password copied.", "green"); },
        function () { toast("Copy failed — select it manually.", "red"); }
      );
    });

    m.querySelector("#am-form").addEventListener("submit", function (e) {
      e.preventDefault();
      errEl.hidden = true;
      var email = m.querySelector("#am-email").value.trim();
      var password = pw.value;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        errEl.textContent = "Enter a valid email.";
        errEl.hidden = false;
        return;
      }
      if (password.length < 8) {
        errEl.textContent = "Password must be at least 8 characters.";
        errEl.hidden = false;
        return;
      }
      var btn = m.querySelector("#am-go");
      btn.disabled = true;
      btn.textContent = "Adding…";
      api("/admin/orgs/" + encodeURIComponent(org.id) + "/members", {
        method: "POST",
        body: {
          email: email,
          password: password,
          full_name: m.querySelector("#am-name").value.trim() || null,
          role: m.querySelector("#am-role").value,
        },
      })
        .then(function () {
          closeModal();
          toast("Member added.", "green");
          render();
        })
        .catch(function (err) {
          btn.disabled = false;
          btn.textContent = "Add member";
          errEl.textContent =
            err.status === 409 ? "That email is already in use." : err.message;
          errEl.hidden = false;
        });
    });
  }

  /* ---------- modal: remove customer ---------- */

  function openRemoveCustomerModal(org) {
    var m = openModal(
      "<h2>Remove " + esc(org.name) + "?</h2>" +
        "<p>Removing this customer takes effect immediately:</p>" +
        '<ul class="p-consequences">' +
        "<li>All members are signed out immediately and can no longer log in.</li>" +
        "<li>Their dashboard stops working.</li>" +
        "<li>The subscription is cancelled.</li>" +
        "<li>Members are notified by email (see the Outbox).</li>" +
        "<li>The removal is recorded in the audit log.</li>" +
        "<li>This cannot be undone from the portal.</li>" +
        "</ul>" +
        '<div class="field"><label for="rm-confirm">Type <strong style="color:var(--text-1); letter-spacing:0;">' +
        esc(org.name) + "</strong> to confirm</label>" +
        '<input id="rm-confirm" type="text" autocomplete="off" spellcheck="false" placeholder="' +
        esc(org.name) + '" /></div>' +
        '<p class="p-form-err" id="rm-err" hidden></p>' +
        '<div class="p-modal-actions">' +
        '<button class="btn btn-ghost btn-sm" type="button" data-x="cancel">Cancel</button>' +
        '<button class="btn btn-sm p-btn-danger" type="button" id="rm-go" disabled>Remove customer</button>' +
        "</div>"
    );

    var input = m.querySelector("#rm-confirm");
    var btn = m.querySelector("#rm-go");
    var errEl = m.querySelector("#rm-err");

    m.querySelector('[data-x="cancel"]').addEventListener("click", closeModal);

    input.addEventListener("input", function () {
      btn.disabled = input.value !== org.name;
    });

    btn.addEventListener("click", function () {
      btn.disabled = true;
      btn.textContent = "Removing…";
      errEl.hidden = true;
      api("/admin/orgs/" + encodeURIComponent(org.id), { method: "DELETE" })
        .then(function (res) {
          closeModal();
          var notified = res && res.members_notified != null ? res.members_notified : 0;
          toast(
            "Removed " + org.name + " — subscription canceled, " + notified + " member(s) notified.",
            "green"
          );
          state.showRemoved = true; // so the org stays visible in the list
          goto("#/orgs");
        })
        .catch(function (err) {
          errEl.textContent = err.message;
          errEl.hidden = false;
          btn.textContent = "Remove customer";
          btn.disabled = input.value !== org.name;
        });
    });
  }

  /* ---------- view: billing ---------- */

  var PAY_METHODS = ["bank_transfer", "check", "card", "cash", "other"];

  function viewBilling(id) {
    loading();
    Promise.all([
      api("/admin/orgs/" + encodeURIComponent(id)),
      api("/admin/plans").catch(function () { return { items: [] }; }),
    ])
      .then(function (res) {
        var d = normalizeDetail(res[0]);
        var org = d.org;
        var sub = d.subscription;
        var plans = listItems(res[1]);
        var planMap = {};
        plans.forEach(function (p) { planMap[String(p.id)] = p; });
        var removed = String(org.status) === "removed";
        var live = sub && String(sub.status) !== "canceled";
        var orgHash = esc(encodeURIComponent(org.id));

        function planOptions(excludeId) {
          return plans
            .filter(function (p) {
              return p.active !== false && String(p.id) !== String(excludeId || "");
            })
            .map(function (p) {
              return (
                '<option value="' + esc(p.id) + '">' + esc(p.name) + " — " +
                fmtMoney(p.amount_cents, p.currency) + " / " + esc(p.interval || "month") +
                "</option>"
              );
            })
            .join("");
        }

        var html =
          '<a class="p-back" href="#/orgs/' + orgHash + '">← ' + esc(org.name) + "</a>" +
          '<div class="p-head"><div><h1>Billing</h1>' +
          '<p class="p-sub">' + esc(org.name) + "</p></div>" +
          '<div class="p-head-actions">' + pill(org.status) + "</div></div>";

        if (removed) {
          html +=
            '<div class="p-banner is-red"><strong>Removed</strong>' +
            "<span>This organization was removed — billing is read-only.</span></div>";
        }

        // subscription panel
        html += '<div class="p-panel"><h2 style="margin-bottom:16px;">Subscription</h2>';
        if (live) {
          var plan = planMap[String(sub.plan_id)];
          html +=
            '<div class="p-detail-grid">' +
            '<div><div class="k">Plan</div><div class="v">' +
            esc(plan ? plan.name : sub.plan_id) +
            (plan ? '<div class="p-note">' + fmtMoney(plan.amount_cents, plan.currency) + " / " + esc(plan.interval || "month") + "</div>" : "") +
            "</div></div>" +
            '<div><div class="k">Status</div><div class="v">' + pill(sub.status) + "</div></div>" +
            '<div><div class="k">Current period</div><div class="v">' +
            fmtDate(sub.current_period_start) + " – " + fmtDate(sub.current_period_end) + "</div></div>" +
            "</div>";
          if (!removed) {
            html +=
              '<div class="p-section-head" style="margin:24px 0 0; justify-content:flex-start; gap:12px;">' +
              '<select class="p-inline-input" id="sub-plan">' + planOptions(sub.plan_id) + "</select>" +
              '<button class="btn btn-ghost btn-sm" type="button" data-action="sub-change">Change plan</button>' +
              '<button class="btn btn-sm p-btn-danger" type="button" data-action="sub-cancel">Cancel subscription</button>' +
              "</div>";
          }
        } else {
          if (sub && sub.canceled_at) {
            html +=
              '<p style="color:var(--text-2); font-size:var(--fs-ui); margin-bottom:16px;">Previous subscription canceled ' +
              fmtDate(sub.canceled_at) + ".</p>";
          }
          html += '<p style="color:var(--text-3); font-style:italic;">No active subscription.</p>';
          if (!removed) {
            html += plans.length
              ? '<div class="p-section-head" style="margin:16px 0 0; justify-content:flex-start; gap:12px;">' +
                '<select class="p-inline-input" id="sub-plan">' + planOptions(null) + "</select>" +
                '<button class="btn btn-primary btn-sm" type="button" data-action="sub-assign">Assign plan</button>' +
                "</div>"
              : '<p class="p-note" style="margin-top:12px;">No plans available to assign.</p>';
          }
        }
        html += "</div>";

        // invoices
        var invoiceRows = d.invoices
          .map(function (inv) {
            var actionable = !removed && (String(inv.status) === "open" || String(inv.status) === "draft");
            return (
              "<tr>" +
              '<td class="strong"><span class="p-id">' + esc(inv.number || inv.id) + "</span></td>" +
              "<td>" + esc(inv.memo || "—") + "</td>" +
              "<td>" + fmtDate(inv.due_at) + "</td>" +
              '<td class="num">' + fmtMoney(inv.amount_due_cents) + "</td>" +
              '<td class="num">' + fmtMoney(inv.amount_paid_cents) + "</td>" +
              "<td>" + pill(inv.status) + "</td>" +
              "<td>" +
              (actionable
                ? '<div class="p-row-actions">' +
                  '<button class="btn btn-ghost btn-sm" type="button" data-action="inv-pay" data-id="' + esc(inv.id) + '">Record payment</button>' +
                  '<button class="btn btn-ghost btn-sm" type="button" data-action="inv-void" data-id="' + esc(inv.id) + '">Void</button>' +
                  "</div>"
                : "") +
              "</td></tr>"
            );
          })
          .join("");

        html +=
          '<div class="p-section"><div class="p-section-head"><h2>Invoices</h2>' +
          (removed
            ? ""
            : '<button class="btn btn-primary btn-sm" type="button" data-action="inv-new">New invoice</button>') +
          "</div>" +
          '<div class="p-table-wrap"><table class="p-table"><thead><tr>' +
          '<th>Number</th><th>Memo</th><th>Due</th><th class="num">Amount</th><th class="num">Paid</th><th>Status</th><th></th>' +
          "</tr></thead><tbody>" +
          (d.invoices.length
            ? invoiceRows
            : '<tr class="p-empty-row"><td colspan="7">No invoices yet.</td></tr>') +
          "</tbody></table></div>" +
          "</div>";

        // payments
        var invNumber = {};
        d.invoices.forEach(function (inv) { invNumber[String(inv.id)] = inv.number; });
        var paymentRows = d.payments
          .map(function (p) {
            return (
              "<tr>" +
              "<td>" + fmtDateTime(p.received_at) + "</td>" +
              '<td class="strong num">' + fmtMoney(p.amount_cents) + "</td>" +
              "<td>" + esc(String(p.method || "—").replace(/_/g, " ")) + "</td>" +
              '<td><span class="p-id">' + esc(invNumber[String(p.invoice_id)] || p.invoice_id || "—") + "</span></td>" +
              '<td><span class="p-id">' + esc(p.reference || "—") + "</span>" +
              (p.note ? '<div class="p-note">' + esc(p.note) + "</div>" : "") + "</td>" +
              "<td>" + esc(p.recorded_by || "—") + "</td>" +
              "<td>" + pill(p.status) + "</td></tr>"
            );
          })
          .join("");

        html +=
          '<div class="p-section"><div class="p-section-head"><h2>Payments</h2></div>' +
          '<div class="p-table-wrap"><table class="p-table"><thead><tr>' +
          '<th>Received</th><th class="num">Amount</th><th>Method</th><th>Invoice</th><th>Reference</th><th>Recorded by</th><th>Status</th>' +
          "</tr></thead><tbody>" +
          (d.payments.length
            ? paymentRows
            : '<tr class="p-empty-row"><td colspan="7">No payments recorded yet.</td></tr>') +
          "</tbody></table></div>" +
          "</div>";

        view(html);

        /* -- bindings -- */

        function findInvoice(invId) {
          var found = null;
          d.invoices.forEach(function (inv) {
            if (String(inv.id) === String(invId)) found = inv;
          });
          return found;
        }

        bind("sub-assign", function (el) {
          var planId = document.getElementById("sub-plan").value;
          if (!planId) return;
          var label = el.textContent;
          el.disabled = true;
          el.textContent = "Assigning…";
          api("/admin/orgs/" + encodeURIComponent(org.id) + "/subscription", {
            method: "POST",
            body: { plan_id: planId },
          })
            .then(function () { toast("Plan assigned.", "green"); render(); })
            .catch(function (err) {
              el.disabled = false;
              el.textContent = label;
              toast(err.message, "red");
            });
        });

        bind("sub-change", function (el) {
          var planId = document.getElementById("sub-plan").value;
          if (!planId) return;
          var label = el.textContent;
          el.disabled = true;
          el.textContent = "Changing…";
          api("/admin/orgs/" + encodeURIComponent(org.id) + "/subscription", {
            method: "PATCH",
            body: { plan_id: planId },
          })
            .then(function () { toast("Plan changed.", "green"); render(); })
            .catch(function (err) {
              el.disabled = false;
              el.textContent = label;
              toast(err.message, "red");
            });
        });

        bind("sub-cancel", function (el) {
          confirmModal({
            title: "Cancel subscription?",
            body: "Billing stops and the subscription is marked canceled immediately. Members keep dashboard access.",
            confirmLabel: "Cancel subscription",
            danger: true,
          }).then(function (yes) {
            if (!yes) return;
            var label = el.textContent;
            el.disabled = true;
            el.textContent = "Canceling…";
            api("/admin/orgs/" + encodeURIComponent(org.id) + "/subscription", {
              method: "PATCH",
              body: { status: "canceled" },
            })
              .then(function () { toast("Subscription canceled.", "green"); render(); })
              .catch(function (err) {
                el.disabled = false;
                el.textContent = label;
                toast(err.message, "red");
              });
          });
        });

        bind("inv-new", function () { openNewInvoiceModal(org); });

        bind("inv-pay", function (el) {
          var inv = findInvoice(el.getAttribute("data-id"));
          if (inv) openRecordPaymentModal(org, inv);
        });

        bind("inv-void", function (el) {
          var inv = findInvoice(el.getAttribute("data-id"));
          if (!inv) return;
          confirmModal({
            title: "Void invoice " + (inv.number || inv.id) + "?",
            body: "A voided invoice can no longer be paid.",
            confirmLabel: "Void invoice",
            danger: true,
          }).then(function (yes) {
            if (!yes) return;
            var label = el.textContent;
            el.disabled = true;
            el.textContent = "Voiding…";
            api("/admin/invoices/" + encodeURIComponent(inv.id) + "/void", { method: "POST" })
              .then(function () { toast("Invoice voided.", "green"); render(); })
              .catch(function (err) {
                el.disabled = false;
                el.textContent = label;
                toast(err.message, "red");
              });
          });
        });
      })
      .catch(errorView);
  }

  /* ---------- modal: new invoice ---------- */

  function openNewInvoiceModal(org) {
    var m = openModal(
      "<h2>New invoice</h2>" +
        '<p style="margin-bottom:16px;">For ' + esc(org.name) + ".</p>" +
        '<form id="ni-form" novalidate>' +
        '<div class="field"><label for="ni-amount">Amount (USD)</label>' +
        '<input id="ni-amount" type="text" inputmode="decimal" required placeholder="149.00" /></div>' +
        '<div class="field"><label for="ni-due">Due date</label>' +
        '<input id="ni-due" type="date" /></div>' +
        '<div class="field"><label for="ni-memo">Memo</label>' +
        '<input id="ni-memo" type="text" placeholder="September service" /></div>' +
        '<p class="p-form-err" id="ni-err" hidden></p>' +
        '<div class="p-modal-actions">' +
        '<button class="btn btn-ghost btn-sm" type="button" data-x="cancel">Cancel</button>' +
        '<button class="btn btn-primary btn-sm" type="submit" id="ni-go">Create invoice</button>' +
        "</div></form>"
    );

    var errEl = m.querySelector("#ni-err");
    m.querySelector('[data-x="cancel"]').addEventListener("click", closeModal);

    m.querySelector("#ni-form").addEventListener("submit", function (e) {
      e.preventDefault();
      errEl.hidden = true;
      var cents = parseMoney(m.querySelector("#ni-amount").value);
      if (cents === null) {
        errEl.textContent = "Enter an amount greater than zero, e.g. 149.00.";
        errEl.hidden = false;
        return;
      }
      var btn = m.querySelector("#ni-go");
      btn.disabled = true;
      btn.textContent = "Creating…";
      api("/admin/orgs/" + encodeURIComponent(org.id) + "/invoices", {
        method: "POST",
        body: {
          amount_due_cents: cents,
          due_at: m.querySelector("#ni-due").value || null,
          memo: m.querySelector("#ni-memo").value.trim() || null,
        },
      })
        .then(function () {
          closeModal();
          toast("Invoice created.", "green");
          render();
        })
        .catch(function (err) {
          btn.disabled = false;
          btn.textContent = "Create invoice";
          errEl.textContent = err.message;
          errEl.hidden = false;
        });
    });
  }

  /* ---------- modal: record payment ---------- */

  function openRecordPaymentModal(org, inv) {
    var remaining = Math.max(
      0,
      Number(inv.amount_due_cents || 0) - Number(inv.amount_paid_cents || 0)
    );

    var methodOpts = PAY_METHODS.map(function (v) {
      return '<option value="' + esc(v) + '">' + esc(v.replace(/_/g, " ")) + "</option>";
    }).join("");

    var m = openModal(
      "<h2>Record payment</h2>" +
        '<p style="margin-bottom:16px;">Invoice ' + esc(inv.number || inv.id) +
        " · " + fmtMoney(remaining) + " outstanding.</p>" +
        '<form id="rp-form" novalidate>' +
        '<div class="p-form-row">' +
        '<div class="field"><label for="rp-amount">Amount (USD)</label>' +
        '<input id="rp-amount" type="text" inputmode="decimal" required value="' +
        esc((remaining / 100).toFixed(2)) + '" /></div>' +
        '<div class="field"><label for="rp-method">Method</label>' +
        '<select id="rp-method">' + methodOpts + "</select></div>" +
        "</div>" +
        '<div class="field"><label for="rp-ref">Reference</label>' +
        '<input id="rp-ref" type="text" placeholder="Wire #, check #, …" /></div>' +
        '<div class="field"><label for="rp-note">Note</label>' +
        '<input id="rp-note" type="text" /></div>' +
        '<p class="p-form-err" id="rp-err" hidden></p>' +
        '<div class="p-modal-actions">' +
        '<button class="btn btn-ghost btn-sm" type="button" data-x="cancel">Cancel</button>' +
        '<button class="btn btn-primary btn-sm" type="submit" id="rp-go">Record payment</button>' +
        "</div></form>"
    );

    var errEl = m.querySelector("#rp-err");
    m.querySelector('[data-x="cancel"]').addEventListener("click", closeModal);

    m.querySelector("#rp-form").addEventListener("submit", function (e) {
      e.preventDefault();
      errEl.hidden = true;
      var cents = parseMoney(m.querySelector("#rp-amount").value);
      if (cents === null) {
        errEl.textContent = "Enter an amount greater than zero.";
        errEl.hidden = false;
        return;
      }
      var btn = m.querySelector("#rp-go");
      btn.disabled = true;
      btn.textContent = "Recording…";
      api("/admin/orgs/" + encodeURIComponent(org.id) + "/payments", {
        method: "POST",
        body: {
          invoice_id: inv.id,
          amount_cents: cents,
          method: m.querySelector("#rp-method").value,
          reference: m.querySelector("#rp-ref").value.trim() || null,
          note: m.querySelector("#rp-note").value.trim() || null,
        },
      })
        .then(function () {
          closeModal();
          toast("Payment recorded.", "green");
          render();
        })
        .catch(function (err) {
          btn.disabled = false;
          btn.textContent = "Record payment";
          errEl.textContent = err.message;
          errEl.hidden = false;
        });
    });
  }

  /* ---------- view: audit log ---------- */

  function viewAudit() {
    loading();
    var qs = "?limit=" + PAGE_SIZE + "&offset=" + state.auditPage * PAGE_SIZE;
    if (state.auditAction) qs += "&action=" + encodeURIComponent(state.auditAction);
    if (state.auditOrg) qs += "&org_id=" + encodeURIComponent(state.auditOrg);

    api("/admin/audit-log" + qs)
      .then(function (res) {
        var rows = listItems(res);
        var total = listTotal(res, rows);

        var body = rows
          .map(function (a) {
            var detail = a.detail === null || a.detail === undefined ? {} : a.detail;
            var target =
              (a.target_type ? esc(a.target_type) + " " : "") +
              (a.target_id ? idChip(a.target_id) : "");
            return (
              '<tr class="is-click" tabindex="0" data-action="expand" aria-expanded="false">' +
              "<td>" + fmtDateTime(a.created_at) + "</td>" +
              "<td>" + esc(a.actor_type || "—") +
              (a.actor_id ? '<div class="p-note">' + esc(a.actor_id) + "</div>" : "") + "</td>" +
              '<td class="strong">' + esc(a.action) + "</td>" +
              "<td>" + esc(a.org_name || "—") + "</td>" +
              "<td>" + (target || "—") + "</td>" +
              '<td><span class="p-id">' + esc(a.ip || "—") + "</span></td></tr>" +
              '<tr class="p-expand" hidden><td colspan="6"><pre class="p-pre">' +
              esc(JSON.stringify(detail, null, 2)) + "</pre></td></tr>"
            );
          })
          .join("");

        view(
          '<div class="p-head"><div><h1>Audit log</h1>' +
            '<p class="p-sub">' + fmtInt(total) +
            " entries · times in " + tzLabel() + " · click a row for detail</p></div>" +
            '<form id="audit-filter" class="p-head-actions">' +
            '<input class="p-inline-input" id="af-action" type="search" placeholder="Filter by action…" value="' +
            esc(state.auditAction) + '" />' +
            '<input class="p-inline-input" id="af-org" type="search" placeholder="Org id…" value="' +
            esc(state.auditOrg) + '" />' +
            '<button class="btn btn-ghost btn-sm" type="submit">Apply</button>' +
            ((state.auditAction || state.auditOrg)
              ? '<button class="btn btn-ghost btn-sm" type="button" data-action="audit-clear">Clear</button>'
              : "") +
            "</form></div>" +
            '<div class="p-table-wrap"><table class="p-table"><thead><tr>' +
            "<th>Time</th><th>Actor</th><th>Action</th><th>Organization</th><th>Target</th><th>IP</th>" +
            "</tr></thead><tbody>" +
            (rows.length
              ? body
              : '<tr class="p-empty-row"><td colspan="6">' +
                esc(
                  state.auditAction || state.auditOrg
                    ? "No audit entries match these filters."
                    : "No audit activity yet. Admin actions are recorded here."
                ) +
                "</td></tr>") +
            "</tbody></table></div>" +
            pager("auditPage", state.auditPage, rows.length, total)
        );

        document.getElementById("audit-filter").addEventListener("submit", function (e) {
          e.preventDefault();
          state.auditAction = document.getElementById("af-action").value.trim();
          state.auditOrg = document.getElementById("af-org").value.trim();
          state.auditPage = 0;
          render();
        });

        bind("audit-clear", function () {
          state.auditAction = "";
          state.auditOrg = "";
          state.auditPage = 0;
          render();
        });

        bind("expand", toggleExpand);
        bindPager();
      })
      .catch(errorView);
  }

  function toggleExpand(el) {
    var next = el.nextElementSibling;
    if (next && next.classList.contains("p-expand")) {
      next.hidden = !next.hidden;
      el.setAttribute("aria-expanded", next.hidden ? "false" : "true");
    }
  }

  /* ---------- view: email outbox ---------- */

  var OUTBOX_FILTERS = [
    { v: "", label: "All" },
    { v: "captured", label: "Captured" },
    { v: "pending", label: "Pending" },
    { v: "sent", label: "Sent" },
    { v: "failed", label: "Failed" },
  ];

  function viewOutbox() {
    loading();
    var qs =
      "?limit=" + PAGE_SIZE + "&offset=" + state.outboxPage * PAGE_SIZE +
      (state.outboxStatus ? "&status=" + encodeURIComponent(state.outboxStatus) : "");
    api("/admin/email-outbox" + qs)
      .then(function (res) {
        var rows = listItems(res);
        var total = listTotal(res, rows);

        var chips = OUTBOX_FILTERS.map(function (f) {
          return (
            '<button class="p-chip' + (state.outboxStatus === f.v ? " active" : "") +
            '" type="button" data-action="outbox-filter" data-v="' + esc(f.v) + '">' +
            esc(f.label) + "</button>"
          );
        }).join("");

        var body = rows
          .map(function (o) {
            var to = o.to_name
              ? esc(o.to_name) + ' <span class="p-note">' + esc(o.to_email) + "</span>"
              : esc(o.to_email);
            return (
              '<tr class="is-click" tabindex="0" data-action="expand" aria-expanded="false">' +
              "<td>" + fmtDateTime(o.created_at) + "</td>" +
              '<td class="strong">' + to + "</td>" +
              "<td>" + esc(o.subject) + "</td>" +
              '<td><span class="p-id">' + esc(o.template || "—") + "</span></td>" +
              "<td>" + pill(o.status) + "</td>" +
              '<td class="num">' + fmtInt(o.attempts) + "</td>" +
              "<td>" + fmtDateTime(o.sent_at) + "</td></tr>" +
              '<tr class="p-expand" hidden><td colspan="7">' +
              (o.error
                ? '<p class="p-form-err" style="display:block; margin-bottom:8px;">' + esc(o.error) + "</p>"
                : "") +
              '<pre class="p-pre">' + esc(o.body_text || "(empty body)") + "</pre>" +
              (String(o.status) === "failed"
                ? '<div style="margin-top:12px;"><button class="btn btn-ghost btn-sm" type="button" ' +
                  'data-action="outbox-retry" data-id="' + esc(o.id) + '">Retry send</button></div>'
                : "") +
              "</td></tr>"
            );
          })
          .join("");

        view(
          '<div class="p-head"><div><h1>Outbox</h1>' +
            '<p class="p-sub">When SMTP isn&#39;t configured, outgoing email is captured here instead of being sent.</p></div>' +
            '<div class="p-chips">' + chips + "</div></div>" +
            '<div class="p-table-wrap"><table class="p-table"><thead><tr>' +
            '<th>Queued</th><th>To</th><th>Subject</th><th>Template</th><th>Status</th><th class="num">Attempts</th><th>Sent</th>' +
            "</tr></thead><tbody>" +
            (rows.length
              ? body
              : '<tr class="p-empty-row"><td colspan="7">' +
                esc(
                  state.outboxStatus
                    ? "No " + state.outboxStatus + " emails."
                    : "Nothing in the outbox yet."
                ) +
                "</td></tr>") +
            "</tbody></table></div>" +
            pager("outboxPage", state.outboxPage, rows.length, total)
        );

        bind("outbox-filter", function (el) {
          state.outboxStatus = el.getAttribute("data-v") || "";
          state.outboxPage = 0;
          render();
        });
        bindPager();

        bind("expand", toggleExpand);

        bind("outbox-retry", function (el) {
          el.disabled = true;
          el.textContent = "Retrying…";
          api("/admin/email-outbox/" + encodeURIComponent(el.getAttribute("data-id")) + "/retry", {
            method: "POST",
          })
            .then(function () {
              toast("Retry queued.", "green");
              render();
            })
            .catch(function (err) {
              el.disabled = false;
              el.textContent = "Retry send";
              toast(err.message, "red");
            });
        });
      })
      .catch(errorView);
  }

  /* ---------- boot ---------- */

  // show which backend this portal is pointed at (sidebar footer)
  (function () {
    var envEl = document.getElementById("env-host");
    if (!envEl) return;
    var host = API_BASE;
    try { host = new URL(API_BASE).host; } catch (e) { /* keep raw */ }
    envEl.textContent = "api · " + host;
  })();

  if (!location.hash) {
    location.hash = "#/"; // fires hashchange → render
  } else {
    render();
  }

  // backfill the signed-in email after a hard reload (token survives, cheap check)
  (function () {
    var haveEmail = false;
    try { haveEmail = !!sessionStorage.getItem(EMAIL_KEY); } catch (e) {}
    if (getToken() && !haveEmail) {
      api("/auth/admin/me")
        .then(function (res) {
          if (res && res.email) {
            try { sessionStorage.setItem(EMAIL_KEY, res.email); } catch (e) {}
            emailEl.textContent = res.email;
          }
        })
        .catch(function () { /* central 401 already routed to login */ });
    }
  })();
})();
