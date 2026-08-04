/* ============================================================
   SIGHTLINE: shared site behaviour
   Requires: gsap.min.js, ScrollTrigger.min.js (loaded before)
   ============================================================ */

(function () {
  "use strict";

  document.documentElement.classList.remove("no-js");

  var reduceMotion =
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    /[?&]noanim/.test(location.search);
  if (reduceMotion) document.documentElement.classList.add("reduced-motion");

  // QA capture mode: collapse viewport-height sections so tall headless
  // screenshots show the whole page (dev tooling only, no user impact)
  if (/[?&]qa/.test(location.search)) {
    var qaStyle = document.createElement("style");
    qaStyle.textContent =
      ".hero,.hiw-pin{min-height:0 !important}.hero{padding-top:160px !important}";
    document.head.appendChild(qaStyle);
  }

  var hasGsap = typeof gsap !== "undefined";
  if (hasGsap && typeof ScrollTrigger !== "undefined") {
    gsap.registerPlugin(ScrollTrigger);
  }

  /* ---------- page enter: wipe out ---------- */

  function buildWipe() {
    var wipe = document.createElement("div");
    wipe.className = "wipe";
    for (var i = 0; i < 4; i++) {
      var blade = document.createElement("div");
      blade.className = "blade";
      wipe.appendChild(blade);
    }
    var brand = document.createElement("div");
    brand.className = "wipe-brand";
    brand.innerHTML = "<span>Sightline</span>";
    document.body.appendChild(wipe);
    document.body.appendChild(brand);
    return { wipe: wipe, brand: brand };
  }

  var wipeEls = buildWipe();

  function playEnter() {
    if (!hasGsap || reduceMotion) return;
    var cameFromWipe = false;
    try {
      cameFromWipe = sessionStorage.getItem("sl-wipe") === "1";
      sessionStorage.removeItem("sl-wipe");
    } catch (e) {}
    if (!cameFromWipe) return;

    var blades = wipeEls.wipe.querySelectorAll(".blade");
    gsap.set(blades, { scaleY: 1, transformOrigin: "bottom" });
    gsap.set(wipeEls.brand, { opacity: 1 });
    gsap.to(wipeEls.brand, { opacity: 0, duration: 0.3, delay: 0.15 });
    gsap.to(blades, {
      scaleY: 0,
      duration: 0.7,
      ease: "power4.inOut",
      stagger: 0.06,
      delay: 0.1,
    });
  }

  function playExit(href) {
    if (!hasGsap || reduceMotion) {
      window.location.href = href;
      return;
    }
    try {
      sessionStorage.setItem("sl-wipe", "1");
    } catch (e) {}
    var blades = wipeEls.wipe.querySelectorAll(".blade");
    gsap.set(blades, { scaleY: 0, transformOrigin: "top" });
    gsap.to(wipeEls.brand, { opacity: 1, duration: 0.3, delay: 0.25 });
    gsap.to(blades, {
      scaleY: 1,
      duration: 0.6,
      ease: "power4.inOut",
      stagger: 0.05,
      onComplete: function () {
        window.location.href = href;
      },
    });
  }

  // intercept internal navigation
  document.addEventListener("click", function (e) {
    var a = e.target.closest("a");
    if (!a) return;
    var href = a.getAttribute("href");
    if (!href) return;
    if (
      href.indexOf("#") === 0 ||
      href.indexOf("http") === 0 ||
      href.indexOf("mailto:") === 0 ||
      a.target === "_blank" ||
      e.metaKey || e.ctrlKey || e.shiftKey
    )
      return;
    e.preventDefault();
    playExit(href);
  });

  /* ---------- nav ---------- */

  var nav = document.querySelector(".nav");
  if (nav && hasGsap && !reduceMotion) {
    ScrollTrigger.create({
      start: 120,
      onEnter: function () { nav.classList.add("is-compact"); },
      onLeaveBack: function () { nav.classList.remove("is-compact"); },
    });
  }

  var burger = document.querySelector(".nav-burger");
  var mobileMenu = document.querySelector(".mobile-menu");
  if (burger && mobileMenu) {
    burger.addEventListener("click", function () {
      var open = burger.classList.toggle("open");
      mobileMenu.classList.toggle("open", open);
      document.body.style.overflow = open ? "hidden" : "";
    });
  }

  // mark active nav link
  var path = location.pathname.split("/").pop() || "index.html";
  document.querySelectorAll(".nav-links a, .mobile-menu a").forEach(function (a) {
    var href = a.getAttribute("href");
    if (href === path) a.classList.add("active");
  });

  /* ---------- reveal system ---------- */

  function initReveals() {
    var els = gsap.utils.toArray("[data-reveal]");
    els.forEach(function (el) {
      var type = el.getAttribute("data-reveal") || "up";
      var delay = parseFloat(el.getAttribute("data-delay") || 0);
      var from = { opacity: 0, y: 40 };
      if (type === "left") from = { opacity: 0, x: -60, y: 0 };
      if (type === "right") from = { opacity: 0, x: 60, y: 0 };
      if (type === "scale") from = { opacity: 0, scale: 0.92, y: 0 };
      if (type === "fade") from = { opacity: 0, y: 0 };

      gsap.fromTo(el, from, {
        opacity: 1,
        x: 0,
        y: 0,
        scale: 1,
        duration: 1,
        delay: delay,
        ease: "power3.out",
        scrollTrigger: {
          trigger: el,
          start: "top 88%",
          once: true,
        },
      });
    });
  }

  /* ---------- word scrub (metropolis-style manifesto) ---------- */

  function initWordScrub() {
    document.querySelectorAll(".word-scrub").forEach(function (el) {
      // split into words, preserving marked spans (.u-grad etc.)
      var nodes = [];
      function split(node) {
        if (node.nodeType === 3) {
          node.textContent.split(/\s+/).forEach(function (word) {
            if (!word) return;
            var s = document.createElement("span");
            s.className = "w";
            s.textContent = word;
            nodes.push(s);
          });
        } else if (node.nodeType === 1) {
          node.classList.add("w");
          nodes.push(node);
        }
      }
      Array.prototype.slice.call(el.childNodes).forEach(split);
      el.innerHTML = "";
      nodes.forEach(function (n, i) {
        el.appendChild(n);
        el.appendChild(document.createTextNode(" "));
      });

      gsap.fromTo(
        el.querySelectorAll(".w"),
        { opacity: 0.12, y: 8 },
        {
          opacity: 1,
          y: 0,
          stagger: 0.06,
          ease: "none",
          scrollTrigger: {
            trigger: el,
            start: "top 82%",
            end: "bottom 45%",
            scrub: 0.6,
          },
        }
      );
    });
  }

  /* ---------- counters ---------- */

  function initCounters() {
    document.querySelectorAll("[data-count]").forEach(function (el) {
      var target = parseFloat(el.getAttribute("data-count"));
      var decimals = parseInt(el.getAttribute("data-decimals") || "0", 10);
      var obj = { v: 0 };
      gsap.to(obj, {
        v: target,
        duration: 1.8,
        ease: "power2.out",
        scrollTrigger: { trigger: el, start: "top 88%", once: true },
        onUpdate: function () {
          el.textContent = obj.v.toFixed(decimals);
        },
      });
    });
  }

  /* ---------- marquee ---------- */

  function initMarquee() {
    document.querySelectorAll(".marquee-track").forEach(function (track) {
      // duplicate content for seamless loop
      track.innerHTML += track.innerHTML;
      var w = track.scrollWidth / 2;
      gsap.to(track, {
        x: -w,
        duration: w / 60,
        ease: "none",
        repeat: -1,
      });
    });
  }

  /* ---------- card cursor glow ---------- */

  document.querySelectorAll(".card").forEach(function (card) {
    card.addEventListener("mousemove", function (e) {
      var r = card.getBoundingClientRect();
      card.style.setProperty("--mx", e.clientX - r.left + "px");
      card.style.setProperty("--my", e.clientY - r.top + "px");
    });
  });

  /* ---------- custom cursor ring ---------- */

  if (window.matchMedia("(pointer: fine)").matches && !reduceMotion && hasGsap) {
    var ring = document.createElement("div");
    ring.className = "cursor-ring";
    document.body.appendChild(ring);
    var rx = gsap.quickTo(ring, "x", { duration: 0.35, ease: "power3.out" });
    var ry = gsap.quickTo(ring, "y", { duration: 0.35, ease: "power3.out" });
    var shown = false;
    window.addEventListener("mousemove", function (e) {
      if (!shown) {
        document.body.classList.add("cursor-on");
        shown = true;
      }
      rx(e.clientX);
      ry(e.clientY);
    });
    document.addEventListener("mouseover", function (e) {
      if (e.target.closest("a, button, input, textarea, select"))
        ring.classList.add("grow");
    });
    document.addEventListener("mouseout", function (e) {
      if (e.target.closest("a, button, input, textarea, select"))
        ring.classList.remove("grow");
    });
  }

  /* ---------- forms (front-end only, graceful success states) ---------- */

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
        var required = input.hasAttribute("required");
        var val = input.value.trim();
        var bad =
          (required && !val) ||
          (input.type === "email" && val && !validEmail(val));
        field.classList.toggle("invalid", bad);
        if (bad) ok = false;
      });

      // bare newsletter forms (single input, no .field wrapper)
      var loneEmail = form.querySelector("input[type=email]");
      if (loneEmail && !form.querySelector(".field")) {
        if (!validEmail(loneEmail.value.trim())) {
          ok = false;
          if (hasGsap)
            gsap.fromTo(form, { x: -8 }, { x: 0, duration: 0.5, ease: "elastic.out(1, 0.3)" });
          loneEmail.focus();
        }
      }

      if (!ok) return;

      var success = form.parentElement.querySelector(".form-success");
      if (success) {
        form.style.display = "none";
        success.style.display = "flex";
        if (hasGsap)
          gsap.from(success, { opacity: 0, y: 12, duration: 0.6, ease: "power3.out" });
      }
    });
  });

  /* ---------- boot ---------- */

  if (hasGsap && !reduceMotion) {
    initReveals();
    initWordScrub();
    initCounters();
    initMarquee();
    playEnter();
  } else {
    // no-motion fallback: everything visible, counters at final values
    document.querySelectorAll("[data-reveal]").forEach(function (el) {
      el.style.opacity = 1;
    });
    document.querySelectorAll("[data-count]").forEach(function (el) {
      var d = parseInt(el.getAttribute("data-decimals") || "0", 10);
      el.textContent = parseFloat(el.getAttribute("data-count")).toFixed(d);
    });
  }

  // in-view gradient underlines outside word-scrub blocks
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) en.target.classList.add("is-inview");
        });
      },
      { threshold: 0.6 }
    );
    document.querySelectorAll(".u-grad").forEach(function (el) {
      if (!el.closest(".word-scrub")) io.observe(el);
    });
  }
})();
