/* ============================================================
   SIGHTLINE — detection replay, vanilla rAF (no dependencies).
   Replays the real pass on the 100-space lot: draws slots.json
   polygons over the genuine frame, synced to a scan sweep.

   DOM contract (the .monitor component):
     svg#replay-svg   overlay inside .monitor-stage
     #replay-scan     .monitor-scan element
     #count-taken #count-open #count-pct   telemetry cells
   ============================================================ */

(function () {
  "use strict";

  var svg = document.getElementById("replay-svg");
  if (!svg) return;

  var scan = document.getElementById("replay-scan");
  var takenEl = document.getElementById("count-taken");
  var openEl = document.getElementById("count-open");
  var pctEl = document.getElementById("count-pct");

  var reduceMotion =
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    /[?&]noanim/.test(location.search);

  // read tokens from the svg's own scope, so the monitor's dark evidence
  // section resolves the DARK values even on a light page
  var css = getComputedStyle(svg);
  var COL_TAKEN = (css.getPropertyValue("--danger") || "#ff8a80").trim();
  var COL_OPEN = (css.getPropertyValue("--accent") || "#00e676").trim();

  var NS = "http://www.w3.org/2000/svg";
  var W = 1280;

  fetch("assets/data/slots.json")
    .then(function (r) { return r.json(); })
    .then(function (data) { build(data.slots); })
    .catch(function () {
      if (scan) scan.style.display = "none";
    });

  function centroidX(poly) {
    var x = 0;
    poly.forEach(function (p) { x += p[0]; });
    return x / poly.length;
  }

  function build(slots) {
    var taken = 0;
    var open = 0;

    var polys = slots
      .map(function (slot) {
        var el = document.createElementNS(NS, "polygon");
        el.setAttribute(
          "points",
          slot.polygon.map(function (p) { return p[0] + "," + p[1]; }).join(" ")
        );
        var occ = slot.expected_occupied;
        if (occ) taken++; else open++;
        var color = occ ? COL_TAKEN : COL_OPEN;
        el.setAttribute("stroke", color);
        el.setAttribute("fill", color);
        el.setAttribute("stroke-width", "2.4");
        el.setAttribute("stroke-opacity", "0");
        el.setAttribute("fill-opacity", "0");
        el.setAttribute("vector-effect", "non-scaling-stroke");
        svg.appendChild(el);
        return { el: el, occ: occ, cx: centroidX(slot.polygon), lit: false, litAt: 0 };
      })
      .sort(function (a, b) { return a.cx - b.cx; });

    var total = taken + open;

    function setCounts(t, o) {
      if (takenEl) takenEl.textContent = t;
      if (openEl) openEl.textContent = o;
      if (pctEl) pctEl.textContent = t + o > 0 ? Math.round((t / (t + o)) * 100) : 0;
    }

    if (reduceMotion) {
      polys.forEach(function (p) {
        p.el.setAttribute("stroke-opacity", "0.95");
        p.el.setAttribute("fill-opacity", "0.16");
      });
      setCounts(taken, open);
      if (scan) scan.style.display = "none";
      return;
    }

    /* rAF timeline: 0.9s hold → 3.2s sweep → settle */
    var DELAY = 900;
    var SWEEP = 3200;
    var IGNITE = 350;   // per-polygon flash-in
    var SETTLE = 800;   // fade from flash to resting fill
    var start = null;
    var litTaken = 0;
    var litOpen = 0;

    function frame(ts) {
      if (start === null) start = ts;
      var t = ts - start;

      if (t < DELAY) { requestAnimationFrame(frame); return; }

      var sw = Math.min(1, (t - DELAY) / SWEEP);
      // ease-in-out sweep
      var eased = sw < 0.5 ? 2 * sw * sw : 1 - Math.pow(-2 * sw + 2, 2) / 2;
      var x = eased * W;

      if (scan) {
        scan.style.opacity = sw < 1 ? "1" : String(Math.max(0, 1 - (t - DELAY - SWEEP) / 500));
        scan.style.left = (eased * 100) + "%";
      }

      polys.forEach(function (p) {
        if (!p.lit && p.cx <= x) {
          p.lit = true;
          p.litAt = t;
          if (p.occ) litTaken++; else litOpen++;
          setCounts(litTaken, litOpen);
        }
        if (p.lit) {
          var age = t - p.litAt;
          var so, fo;
          if (age < IGNITE) {
            var k = age / IGNITE;
            so = 0.95 * k;
            fo = 0.28 * k;
          } else if (age < IGNITE + SETTLE) {
            var k2 = (age - IGNITE) / SETTLE;
            so = 0.95;
            fo = 0.28 - 0.14 * k2;
          } else {
            so = 0.95;
            fo = 0.14;
          }
          p.el.setAttribute("stroke-opacity", so.toFixed(3));
          p.el.setAttribute("fill-opacity", fo.toFixed(3));
        }
      });

      var done =
        sw >= 1 &&
        polys.every(function (p) { return p.lit && t - p.litAt > IGNITE + SETTLE; });

      if (!done) requestAnimationFrame(frame);
      else {
        setCounts(taken, open);
        if (scan) scan.style.opacity = "0";
      }
    }

    requestAnimationFrame(frame);
  }
})();
