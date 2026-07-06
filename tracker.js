(function () {
  "use strict";

  const cfg = window.SITESCAPE_CONFIG || {};
  const ENDPOINT = cfg.endpoint || "https://localhost:5000/collect";
  const APP_ID = cfg.appId || "unknown-app";

  /* ── helpers ──────────────────────────────────────────────── */

  function getOrCreateSession() {
    const KEY = "ss_sid";
    let sid = sessionStorage.getItem(KEY);
    if (!sid) {
      sid = crypto.randomUUID
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2);
      sessionStorage.setItem(KEY, sid);
    }
    return sid;
  }

  function getOrCreateVisitor() {
    const KEY = "ss_vid";
    let vid = localStorage.getItem(KEY);
    if (!vid) {
      vid = crypto.randomUUID
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2);
      localStorage.setItem(KEY, vid);
    }
    return vid;
  }

  function parseReferrer(ref) {
    if (!ref) return { source: "direct", referrer: "" };
    try {
      const u = new URL(ref);
      const host = u.hostname.replace(/^www\./, "");
      const knownSearch = {
        "google.com": "Google",
        "bing.com": "Bing",
        "duckduckgo.com": "DuckDuckGo",
        "yahoo.com": "Yahoo",
      };
      const knownSocial = {
        "facebook.com": "Facebook",
        "twitter.com": "Twitter",
        "x.com": "X",
        "instagram.com": "Instagram",
        "linkedin.com": "LinkedIn",
        "reddit.com": "Reddit",
      };
      if (knownSearch[host])
        return { source: "search:" + knownSearch[host], referrer: ref };
      if (knownSocial[host])
        return { source: "social:" + knownSocial[host], referrer: ref };
      return { source: "referral:" + host, referrer: ref };
    } catch (_) {
      return { source: "unknown", referrer: ref };
    }
  }

  function utmParams() {
    const p = new URLSearchParams(location.search);
    const out = {};
    for (const k of [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
    ]) {
      if (p.has(k)) out[k] = p.get(k);
    }
    return out;
  }

  /* ── core send ────────────────────────────────────────────── */

  function buildPayload(eventName, extra) {
    const { source, referrer } = parseReferrer(document.referrer);
    return {
      app_id: APP_ID,
      event: eventName,
      session_id: getOrCreateSession(),
      visitor_id: getOrCreateVisitor(),
      url: location.href,
      path: location.pathname,
      title: document.title,
      referrer,
      source,
      utm: utmParams(),
      screen_w: screen.width,
      screen_h: screen.height,
      language: navigator.language,
      ts: new Date().toISOString(),
      ...extra,
    };
  }

  // Normal events: use fetch with keepalive:true.
  // fetch goes through the full CORS flow (preflight OPTIONS then POST)
  // and keepalive:true lets it survive short page navigations.
  function send(eventName, extra) {
    const payload = buildPayload(eventName, extra);
    fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {});
  }

  // Unload-only: sendBeacon is the only reliable way to deliver data when the
  // page is being torn down and fetch would be cancelled. We send as text/plain
  // (no CORS preflight, which sendBeacon can't wait for anyway). The Flask
  // server handles both application/json and text/plain body parsing.
  function sendOnUnload(eventName, extra) {
    const payload = buildPayload(eventName, extra);
    const blob = new Blob([JSON.stringify(payload)], { type: "text/plain" });
    if (navigator.sendBeacon && navigator.sendBeacon(ENDPOINT, blob)) return;
    // sendBeacon quota exceeded — keepalive fetch is the best remaining option
    fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {});
  }

  /* ── page-view ────────────────────────────────────────────── */

  function trackPageView() {
    send("pageview");
  }

  /* ── SPA support: intercept pushState / replaceState ─────── */

  const _push = history.pushState.bind(history);
  const _replace = history.replaceState.bind(history);

  history.pushState = function (...args) {
    _push(...args);
    setTimeout(trackPageView, 0);
  };
  history.replaceState = function (...args) {
    _replace(...args);
    setTimeout(trackPageView, 0);
  };
  window.addEventListener("popstate", () => setTimeout(trackPageView, 0));

  /* ── session duration on unload ──────────────────────────── */

  const sessionStart = Date.now();
  window.addEventListener("pagehide", () => {
    sendOnUnload("session_end", { duration_ms: Date.now() - sessionStart });
  });

  /* ── public API ───────────────────────────────────────────── */

  window.SiteScope = {
    /**
     * Track a custom event.
     * SiteScope.track("signup_click", { plan: "pro" });
     */
    track(name, props) {
      send(name, props || {});
    },
  };

  /* ── fire initial page-view ───────────────────────────────── */
  trackPageView();
})();
