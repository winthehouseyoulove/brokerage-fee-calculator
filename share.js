// One link that carries both pages. The planning page writes the payload, the
// comparison page reads its half of it, and the nav links between them keep
// the hash so a saved link survives a trip across the tool.
(function (global) {
  'use strict';

  const KEY = 's=';
  // Both pages write their own half here as the user works, so one link can
  // carry a scenario they built by moving between them. Session-scoped: it is
  // this tab's work in progress, not a saved document.
  const SESSION_KEY = 'remax-share-state';

  // Base64 over the raw UTF-8 bytes. Percent-encoding first would survive
  // unicode too, but it inflates the link by half again for no gain.
  function encode(payload) {
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    let bin = '';
    bytes.forEach(b => { bin += String.fromCharCode(b); });
    return KEY + btoa(bin);
  }

  // Returns {} when there is no payload, or when it is anything but a v1
  // object, so a hand-mangled link degrades to the normal page.
  function read() {
    try {
      const raw = (global.location.hash || '').replace(/^#/, '');
      if (!raw.startsWith(KEY)) return {};
      const bin = atob(raw.slice(KEY.length));
      const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
      const payload = JSON.parse(new TextDecoder().decode(bytes));
      if (!payload || payload.v !== 1) return {};
      return payload;
    } catch (e) {
      return {};
    }
  }

  // Put the payload in the address bar without adding a history entry, so the
  // back button still leaves the page.
  function write(payload) {
    const url = global.location.origin + global.location.pathname + global.location.search + '#' + encode(payload);
    try { global.history.replaceState(null, '', url); } catch (e) {}
    return url;
  }

  // Copy the current address. The clipboard API needs a secure context and a
  // user gesture; the textarea fallback covers the rest.
  function copy(text) {
    if (global.navigator.clipboard && global.isSecureContext) {
      return global.navigator.clipboard.writeText(text).then(() => true).catch(() => fallback(text));
    }
    return Promise.resolve(fallback(text));
  }
  function fallback(text) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) {
      return false;
    }
  }

  // Copy only the keys a page already knows about, and only when the type
  // matches, so an old or edited payload cannot inject anything unexpected.
  function adopt(target, source) {
    if (!source) return false;
    let any = false;
    Object.keys(target).forEach(k => {
      if (source[k] !== undefined && typeof source[k] === typeof target[k]) {
        target[k] = source[k];
        any = true;
      }
    });
    return any;
  }

  function session() {
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)) || {}; } catch (e) { return {}; }
  }
  function remember(payload) {
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(payload)); } catch (e) {}
  }

  // A link someone opened describes a finished scenario, so it seeds the tab.
  // After that the tab's own state is what the copy button hands out, so the
  // link leaves the address bar: left there, a reload would lay it over every
  // change made since, and the nav used to carry it to the other page too.
  // Moving between the pages needs no link; the session carries it.
  function begin() {
    const fromLink = read();
    if (fromLink.v === 1) {
      if (!fromLink.c) fromLink.c = legacyCommon(fromLink);
      remember(fromLink);
      // The agent and custom plan in a link outrank what this browser last used.
      storeCommon(fromLink.c);
      try {
        global.history.replaceState(null, '', global.location.pathname + global.location.search);
      } catch (e) {}
    }
    return session();
  }

  // Links copied before the shared slot existed kept the agent in the plan
  // builder's half and the custom plan in whichever page wrote it.
  function legacyCommon(payload) {
    const p = payload.p || {}, i = payload.i || {};
    const c = {};
    if (typeof p.agentName === 'string') c.agentName = p.agentName;
    const plan = p.customPlan || i.customPlan;
    if (plan && typeof plan === 'object') c.customPlan = plan;
    const show = p.showCustomPlan !== undefined ? p.showCustomPlan : i.showCustom;
    if (typeof show === 'boolean') c.showCustom = show;
    return c;
  }

  // Each page owns one half: 'p' the plan builder, 'i' the comparison page.
  // Merged field by field, so a page that writes only what it derives cannot
  // wipe a choice the other page's own controls made.
  function contribute(key, half) {
    const merged = session();
    merged.v = 1;
    merged[key] = Object.assign({}, merged[key] || {}, half);
    remember(merged);
  }

  // 'c' belongs to neither page: the agent and the custom plan. Pick or edit
  // them on either page, in any tab, and the other page shows the same ones.
  //   agentName   '' when nobody is matched
  //   customPlan  the terms below
  //   showCustom  whether the custom plan card is on the page
  //
  // localStorage is the copy that counts, because it is the one every tab
  // sees. The session keeps a copy for the share link and stands in only when
  // the browser blocks storage. Letting the session copy win, as the first
  // version did, left a second tab on whatever agent it had picked before.
  const COMMON_KEY = 'remax-shared-common';
  function storedCommon() {
    try { return JSON.parse(localStorage.getItem(COMMON_KEY)) || null; } catch (e) { return null; }
  }
  function storeCommon(c) {
    try {
      const text = JSON.stringify(c);
      // An unchanged write would still wake the other tab on some browsers
      if (localStorage.getItem(COMMON_KEY) !== text) localStorage.setItem(COMMON_KEY, text);
    } catch (e) {}
  }
  function common() {
    const stored = storedCommon();
    if (stored && typeof stored === 'object') return stored;
    const c = session().c;
    return c && typeof c === 'object' ? c : null;
  }
  function setCommon(half) {
    const c = Object.assign({}, common() || {}, half);
    const s = session();
    s.v = 1;
    s.c = c;
    remember(s);
    storeCommon(c);
  }

  // Tells the page when another tab changes the agent or the custom plan, and
  // when the browser restores this page from its back/forward cache. A
  // restored page runs no script, so without this the Back button shows the
  // agent the page had when it was left.
  function onCommonChange(fn) {
    global.addEventListener('storage', (e) => {
      if (e.key !== COMMON_KEY || !e.newValue) return;
      let c;
      try { c = JSON.parse(e.newValue); } catch (err) { return; }
      const s = session();
      s.v = 1;
      s.c = c;
      remember(s);
      fn(c);
    });
    global.addEventListener('pageshow', (e) => {
      if (!e.persisted) return;
      const c = common();
      if (c) fn(c);
    });
  }

  // The custom plan terms both pages edit. Each page keeps its own key and
  // styling on the plan object; only these travel.
  const PLAN_TERMS = ['name', 'monthly', 'annualDues', 'perTransaction', 'splitRate', 'cap', 'postCapRate'];
  function planTerms(plan) {
    const out = {};
    PLAN_TERMS.forEach(k => { out[k] = plan[k]; });
    return out;
  }
  function adoptPlan(target, source) {
    if (!source || typeof source !== 'object') return;
    PLAN_TERMS.forEach(k => {
      if (typeof source[k] === typeof target[k]) target[k] = source[k];
    });
  }

  // The link lands on the page the sender was using, carrying the agent and
  // custom plan as they stand now, even if another tab set them.
  function linkFor() {
    const payload = session();
    const c = common();
    if (c) payload.c = c;
    return global.location.origin + global.location.pathname + '#' + encode(payload);
  }

  // The copy control sits in the corner of both pages: a link that becomes a
  // tick on the way out, so the confirmation is the button itself.
  function mountDock() {
    const btn = document.getElementById('btnSaveLink');
    if (!btn) return;
    const restLabel = btn.getAttribute('aria-label') || 'Copy a link to this plan';
    let resetTimer = null;
    function say(text) {
      btn.setAttribute('aria-label', text);
      btn.setAttribute('title', text);
    }
    btn.addEventListener('click', () => {
      const url = linkFor();
      copy(url).then(ok => {
        // Only a failed copy leaves the link in the address bar to copy by
        // hand. Left there otherwise, a reload would reapply it over later edits.
        if (!ok) { try { global.history.replaceState(null, '', url); } catch (e) {} }
        btn.classList.add('is-done');
        say(ok ? 'Link copied' : 'The link is in the address bar');
        clearTimeout(resetTimer);
        resetTimer = setTimeout(() => {
          btn.classList.remove('is-done');
          say(restLabel);
        }, 2600);
      });
    });
  }

  global.Share = {
    read, write, copy, adopt, begin, session, contribute, linkFor, mountDock,
    common, setCommon, onCommonChange, planTerms, adoptPlan,
  };
})(window);
