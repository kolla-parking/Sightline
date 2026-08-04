/* ============================================================
   SIGHTLINE: home hero: replay of a real detection pass.
   Draws the 100 genuine PKLot slot polygons (slots.json) over
   the genuine camera frame, synced to a scan-line sweep.
   ============================================================ */

(function () {
  "use strict";

  var reduceMotion =
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    /[?&]noanim/.test(location.search);
  var svg = document.getElementById("hero-svg");
  var scan = document.getElementById("hero-scan");
  if (!svg || typeof gsap === "undefined") return;

  var NS = "http://www.w3.org/2000/svg";
  var W = 1280;
  var H = 720;

  fetch("assets/data/slots.json")
    .then(function (r) { return r.json(); })
    .then(function (data) { build(data.slots); })
    .catch(function () {
      // slots are decorative; page still works without them (decorative)
      if (scan) scan.style.display = "none";
    });

  function centroid(poly) {
    var x = 0, y = 0;
    poly.forEach(function (p) { x += p[0]; y += p[1]; });
    return [x / poly.length, y / poly.length];
  }

  function build(slots) {
    // sort by centroid x so polygons ignite as the sweep passes
    var sorted = slots.slice().sort(function (a, b) {
      return centroid(a.polygon)[0] - centroid(b.polygon)[0];
    });

    var occupied = 0;
    var free = 0;
    var polys = sorted.map(function (slot) {
      var el = document.createElementNS(NS, "polygon");
      el.setAttribute(
        "points",
        slot.polygon.map(function (p) { return p[0] + "," + p[1]; }).join(" ")
      );
      var occ = slot.expected_occupied;
      if (occ) occupied++; else free++;
      var color = occ ? "#ff4d2e" : "#2ee58a";
      el.setAttribute("stroke", color);
      el.setAttribute("fill", color);
      el.setAttribute("stroke-width", "2.4");
      el.setAttribute("fill-opacity", "0");
      el.setAttribute("stroke-opacity", "0");
      el.setAttribute("vector-effect", "non-scaling-stroke");
      svg.appendChild(el);
      return { el: el, occ: occ, cx: centroid(slot.polygon)[0] };
    });

    var occEl = document.getElementById("count-occupied");
    var freeEl = document.getElementById("count-free");
    var pctEl = document.getElementById("count-pct");
    var totalSlots = occupied + free;

    if (reduceMotion) {
      // static final state
      polys.forEach(function (p) {
        p.el.setAttribute("stroke-opacity", "0.95");
        p.el.setAttribute("fill-opacity", "0.16");
      });
      if (occEl) occEl.textContent = occupied;
      if (freeEl) freeEl.textContent = free;
      if (pctEl) pctEl.textContent = Math.round((occupied / totalSlots) * 100);
      if (scan) scan.style.display = "none";
      return;
    }

    /* ---- master timeline: sweep + ignite + count ---- */

    var sweep = { x: 0 };
    var counts = { occ: 0, free: 0 };
    var litOcc = 0, litFree = 0;

    var tl = gsap.timeline({ delay: 0.9 });

    // scan line sweeps across the frame once
    if (scan) {
      tl.set(scan, { opacity: 1 }, 0);
      tl.to(sweep, {
        x: W,
        duration: 3.2,
        ease: "power1.inOut",
        onUpdate: function () {
          var pct = (sweep.x / W) * 100;
          scan.style.left = pct + "%";
          // ignite polygons the sweep has passed
          polys.forEach(function (p) {
            if (!p.lit && p.cx <= sweep.x) {
              p.lit = true;
              if (p.occ) litOcc++; else litFree++;
              if (occEl) occEl.textContent = litOcc;
              if (freeEl) freeEl.textContent = litFree;
              if (pctEl && (litOcc + litFree) > 0)
                pctEl.textContent = Math.round((litOcc / (litOcc + litFree)) * 100);
              gsap.fromTo(
                p.el,
                { strokeOpacity: 0, fillOpacity: 0 },
                {
                  strokeOpacity: 0.95,
                  fillOpacity: 0.28,
                  duration: 0.35,
                  ease: "power2.out",
                  onComplete: function () {
                    gsap.to(p.el, {
                      fillOpacity: 0.14,
                      duration: 0.8,
                      ease: "power2.out",
                    });
                  },
                }
              );
            }
          });
        },
      }, 0);
      tl.to(scan, { opacity: 0, duration: 0.5 }, ">-0.2");
    }

    // gentle persistent shimmer on occupied slots
    tl.add(function () {
      var occEls = polys
        .filter(function (p) { return p.occ; })
        .map(function (p) { return p.el; });
      gsap.to(occEls, {
        fillOpacity: 0.24,
        duration: 1.6,
        ease: "sine.inOut",
        yoyo: true,
        repeat: -1,
        stagger: { each: 0.02, from: "random" },
      });
    });
  }
})();
