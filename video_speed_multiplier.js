// ==UserScript==
// @name         Hold Middle Mouse for Video Speed
// @namespace    https://violentmonkey.github.io/
// @version      1.2.0
// @description  Hold the middle mouse button to play the biggest video on the page at 2x/3x/4x. Shows an overlay indicator, works in fullscreen and iframes.
// @match        *://*/*
// @match        file:///*
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// ==/UserScript==

(function () {
  'use strict';

  const KEY = 'speedMultiplier';
  const DEFAULT_SPEED = 2;
  const OPTIONS = [2, 3, 4];

  const getSpeed = () => {
    const v = parseFloat(GM_getValue(KEY, DEFAULT_SPEED));
    return OPTIONS.includes(v) ? v : DEFAULT_SPEED;
  };

  const fmt = (n) => (Math.round(n * 100) / 100).toString();

  /* ---------------- Video detection ---------------- */

  function collectVideos(root, out) {
    let nodes;
    try { nodes = root.querySelectorAll('*'); } catch (e) { return out; }
    for (const el of nodes) {
      if (el.tagName === 'VIDEO') out.push(el);
      if (el.shadowRoot) collectVideos(el.shadowRoot, out);
    }
    return out;
  }

  function getBiggestVideo() {
    const videos = collectVideos(document, []);
    let best = null, bestArea = 0;
    const vw = window.innerWidth, vh = window.innerHeight;
    for (const v of videos) {
      const r = v.getBoundingClientRect();
      const w = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
      const h = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
      const area = w * h;
      if (area > bestArea) { bestArea = area; best = v; }
    }
    if (best) return best;
    for (const v of videos) {
      const r = v.getBoundingClientRect();
      const area = r.width * r.height;
      if (area > bestArea) { bestArea = area; best = v; }
    }
    return best;
  }

  /* ---------------- Overlay ---------------- */

  let host = null, badge = null, rafId = 0;

  function ensureOverlay() {
    if (!host) {
      host = document.createElement('div');
      host.style.cssText = 'all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;pointer-events:none;';
      const root = host.attachShadow({ mode: 'closed' });
      badge = document.createElement('div');
      badge.style.cssText = [
        'position:fixed', 'padding:4px 10px', 'border-radius:6px',
        'background:rgba(0,0,0,0.75)', 'color:#fff',
        'font:600 14px/1.4 system-ui,Arial,sans-serif',
        'letter-spacing:0.3px', 'pointer-events:none',
        'box-shadow:0 2px 8px rgba(0,0,0,0.4)'
      ].join(';');
      root.appendChild(badge);
    }
    const fs = document.fullscreenElement || document.webkitFullscreenElement;
    const parent = fs && fs.tagName !== 'VIDEO' ? fs : document.documentElement;
    if (host.parentNode !== parent) parent.appendChild(host);
  }

  function positionOverlay(video) {
    const r = video.getBoundingClientRect();
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const top = Math.max(r.top, 0) + 10;
    const right = vw - Math.min(r.right, vw) + 10;
    badge.style.top = top + 'px';
    badge.style.right = right + 'px';
  }

  function showOverlay(video, speed) {
    ensureOverlay();
    badge.textContent = '▶▶ ' + fmt(speed) + 'x';
    badge.style.display = 'block';
    const loop = () => {
      ensureOverlay();
      positionOverlay(video);
      rafId = requestAnimationFrame(loop);
    };
    cancelAnimationFrame(rafId);
    loop();
  }

  function hideOverlay() {
    cancelAnimationFrame(rafId);
    if (badge) badge.style.display = 'none';
    if (host && host.parentNode) host.parentNode.removeChild(host);
  }

  /* ---------------- Speed control ---------------- */

  let active = null;
  let guardVideo = null;   // video whose ratechange events we hide from the page
  let guardTimer = 0;

  // Hide our own ratechange events from the page (YouTube etc. react to them
  // and re-sync/override state, which causes audio/video desync).
  window.addEventListener('ratechange', (e) => {
    if (guardVideo && e.target === guardVideo) {
      e.stopImmediatePropagation();
    }
  }, true);

  function start() {
    if (active) return;
    const video = getBiggestVideo();
    if (!video) return;
    const target = getSpeed();
    const original = video.playbackRate;

    clearTimeout(guardTimer);
    guardVideo = video;

    const onRate = () => {
      if (active && video.playbackRate !== target) video.playbackRate = target;
    };
    active = { video, original, target, onRate };
    video.addEventListener('ratechange', onRate, true);
    video.playbackRate = target;
    showOverlay(video, target);
  }

  function stop() {
    if (!active) return;
    const { video, original, onRate } = active;
    video.removeEventListener('ratechange', onRate, true);
    active = null;
    hideOverlay();

    video.playbackRate = original;

    // Resync audio/video pipeline after leaving high speed
    setTimeout(() => {
      try {
        if (!video.paused && !video.ended && video.readyState >= 2) {
          video.currentTime = video.currentTime;
        }
      } catch (e) {}
    }, 60);

    // Keep hiding the restore event (it fires asynchronously)
    clearTimeout(guardTimer);
    guardTimer = setTimeout(() => { guardVideo = null; }, 300);
  }

  /* ---------------- Mouse handling ---------------- */

  function isIgnoredTarget(t) {
    if (!t || !t.closest) return false;
    return !!t.closest('a[href], input, textarea, select, [contenteditable=""], [contenteditable="true"]');
  }

  window.addEventListener('mousedown', (e) => {
    if (e.button !== 1 || isIgnoredTarget(e.target)) return;
    if (!getBiggestVideo()) return;
    e.preventDefault();
    start();
  }, true);

  window.addEventListener('mouseup', (e) => {
    if (e.button !== 1 || !active) return;
    e.preventDefault();
    stop();
  }, true);

  window.addEventListener('auxclick', (e) => {
    if (e.button === 1 && (active || (!isIgnoredTarget(e.target) && getBiggestVideo()))) {
      e.preventDefault();
    }
  }, true);

  window.addEventListener('blur', stop, true);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); }, true);
  window.addEventListener('contextmenu', stop, true);
  window.addEventListener('pagehide', stop, true);

  /* ---------------- Speed selection (menu buttons) ---------------- */

  let menuIds = [];

  function buildMenu() {
    if (typeof GM_unregisterMenuCommand === 'function') {
      menuIds.forEach((id) => { try { GM_unregisterMenuCommand(id); } catch (e) {} });
    }
    menuIds = [];
    const current = getSpeed();
    OPTIONS.forEach((s) => {
      const label = (s === current ? '● ' : '○ ') + s + 'x';
      const id = GM_registerMenuCommand(label, () => {
        GM_setValue(KEY, s);
        buildMenu();
      });
      menuIds.push(id);
    });
  }

  if (window === window.top) buildMenu();
})();