/* ============================================================
   SIGHTLINE — Instrument v2 shared behavior. Zero dependencies.
   Reveals (IntersectionObserver), nav state, sheet menu, theme
   switching, form POST wiring, count-up numbers.
   ============================================================ */

(function () {
  "use strict";

  document.documentElement.classList.remove("no-js");

  var reduceMotion =
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    /[?&]noanim/.test(location.search);
  if (reduceMotion) document.documentElement.classList.add("reduced-motion");

  var API_BASE = window.SIGHTLINE_API || "http://localhost:8000";

  /* ---------- mode: light (default) / dark ---------- */
  // the pre-paint snippet in each <head> applies the stored mode (or the
  // OS preference) before first paint; this flips and persists it.
  document.addEventListener("click", function (e) {
    var el = e.target.closest("[data-mode-toggle]");
    if (!el) return;
    var next =
      document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    if (next === "dark") document.documentElement.setAttribute("data-theme", "dark");
    else document.documentElement.removeAttribute("data-theme");
    try { localStorage.setItem("sl-theme", next); } catch (err) { /* storage unavailable */ }
  });

  /* ---------- nav ---------- */

  var nav = document.querySelector(".nav");
  if (nav) {
    var onScroll = function () {
      nav.classList.toggle("scrolled", window.scrollY > 8);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  var burger = document.querySelector(".nav-burger");
  var sheet = document.querySelector(".sheet");
  if (burger && sheet) {
    burger.addEventListener("click", function () {
      var open = burger.classList.toggle("open");
      sheet.classList.toggle("open", open);
      burger.setAttribute("aria-expanded", open ? "true" : "false");
      document.body.style.overflow = open ? "hidden" : "";
    });
  }

  // active link
  var path = location.pathname.split("/").pop() || "index.html";
  document.querySelectorAll(".nav-links a, .sheet a").forEach(function (a) {
    if (a.getAttribute("href") === path) a.classList.add("active");
  });

  /* ---------- reveals ---------- */

  var revealed = document.querySelectorAll("[data-r]");
  if (reduceMotion || !("IntersectionObserver" in window)) {
    revealed.forEach(function (el) { el.classList.add("in"); });
  } else if (revealed.length) {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("in");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: "0px 0px -5% 0px" }
    );
    revealed.forEach(function (el) { io.observe(el); });
  }

  /* ---------- count-up numbers ([data-count]) ---------- */

  function runCount(el) {
    var target = Number(el.getAttribute("data-count"));
    if (isNaN(target)) return;
    if (reduceMotion) { el.textContent = target.toLocaleString("en-US"); return; }
    var start = null;
    var dur = 900;
    function tick(ts) {
      if (start === null) start = ts;
      var p = Math.min(1, (ts - start) / dur);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(target * eased).toLocaleString("en-US");
      if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  var counters = document.querySelectorAll("[data-count]");
  if (counters.length) {
    if (reduceMotion || !("IntersectionObserver" in window)) {
      counters.forEach(runCount);
    } else {
      var cio = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (entry.isIntersecting) {
              runCount(entry.target);
              cio.unobserve(entry.target);
            }
          });
        },
        { threshold: 0.6 }
      );
      counters.forEach(function (el) { cio.observe(el); });
    }
  }

  /* ---------- forms ----------
     Contract preserved from the working backend wiring:
     <form data-form data-endpoint="/public/..."> with named inputs and a
     hidden honeypot input name="website". No endpoint = cosmetic success. */

  function showSuccess(form) {
    var success = form.parentElement.querySelector(".form-success");
    if (success) {
      form.style.display = "none";
      success.style.display = "flex";
    }
  }

  function validEmail(v) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  }

  document.querySelectorAll("form[data-form]").forEach(function (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var ok = true;

      form.querySelectorAll(".field").forEach(function (field) {
        var input = field.querySelector("input, textarea, select");
        if (!input) return;
        var val = input.value.trim();
        var bad =
          (input.hasAttribute("required") && !val) ||
          (input.type === "email" && val && !validEmail(val));
        field.classList.toggle("invalid", bad);
        if (bad) ok = false;
      });

      // bare single-email forms (no .field wrapper)
      var lone = form.querySelector("input[type=email]");
      if (lone && !form.querySelector(".field")) {
        if (!validEmail(lone.value.trim())) { ok = false; lone.focus(); }
      }

      if (!ok) return;

      var endpoint = form.getAttribute("data-endpoint");
      if (!endpoint) { showSuccess(form); return; }

      // honeypot: silently succeed without sending
      var trap = form.querySelector('input[name="website"]');
      if (trap && trap.value) { showSuccess(form); return; }

      var btn = form.querySelector('button[type="submit"]');
      var label = btn ? btn.textContent : "";
      if (btn) { btn.disabled = true; btn.textContent = "Sending…"; }
      var note = form.querySelector(".send-note");

      fetch(API_BASE + endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(new FormData(form))),
      })
        .then(function (res) {
          if (!res.ok) throw new Error("bad status");
          showSuccess(form);
        })
        .catch(function () {
          if (btn) { btn.disabled = false; btn.textContent = label; }
          if (!note) {
            note = document.createElement("p");
            note.className = "send-note";
            form.appendChild(note);
          }
          note.textContent = "Something went wrong sending this — please email us directly.";
          note.style.display = "block";
        });
    });
  });
})();
