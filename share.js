// One link that carries both pages. The planning page writes the payload, the
// comparison page reads its half of it, and the nav links between them keep
// the hash so a saved link survives a trip across the tool.
(function (global) {
  'use strict';

  const KEY = 's=';

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

  // Both pages link to each other in the header. Carry the payload across so
  // the other page opens on the same scenario.
  function carryIntoLinks() {
    const hash = global.location.hash;
    if (!hash.replace(/^#/, '').startsWith(KEY)) return;
    document.querySelectorAll('.top-nav a[href]').forEach(a => {
      const href = a.getAttribute('href');
      if (/^https?:|^#/.test(href)) return;
      a.setAttribute('href', href.split('#')[0] + hash);
    });
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

  global.Share = { read, write, copy, carryIntoLinks, adopt };
})(window);
