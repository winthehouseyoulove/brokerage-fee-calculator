// A light gate that keeps casual visitors off the site. It is not security:
// the site is static and public, and anyone who reads the source can get
// past it. It stops someone who stumbles on the address from browsing the
// tools. The code itself is not stored here, only its SHA-256, and a visitor
// who enters it once is remembered in localStorage. A four-digit code's
// hash can be reversed by trying all 10,000, so the hash only keeps the code
// out of plain sight. Changing the code changes the hash, which also locks
// out everyone who entered the old one.
//
// Runs from <head> so the page never paints before the gate covers it.
(function () {
  'use strict';

  var HASH = '6278894ef596d714fa91627ddbe50ef3f3b27da412ddf96a7de1e3ccf9903a83';
  var KEY = 'remax-gate';
  var root = document.documentElement;

  function isOpen() {
    try { return localStorage.getItem(KEY) === HASH; } catch (e) { return false; }
  }
  if (isOpen()) return;

  root.classList.add('gated');
  var css = document.createElement('style');
  css.textContent = [
    // Everything on the page stays unpainted, and unreachable by keyboard or
    // screen reader, until the code is in. The page's own scripts still run.
    'html.gated body > *:not(#gate) { visibility: hidden !important; }',
    'html.gated body { overflow: hidden; }',
    '#gate { position: fixed; inset: 0; z-index: 2000; overflow-y: auto; background: #f7f5ee;',
    '  color: #0C2749; display: flex; flex-direction: column; align-items: center;',
    '  justify-content: center; gap: 28px; padding: 32px 20px; box-sizing: border-box; }',
    // The office lockup follows the site header: logo 30px tall, office name
    // 16px in black, 12px away, centred on the REMAX letters.
    '#gate .gate-lockup { display: flex; align-items: center; gap: 12px; }',
    '#gate .gate-lockup img { height: 30px; width: auto; display: block; }',
    '#gate .gate-lockup span { font-size: 16px; font-weight: 500; color: #000; line-height: 1;',
    '  transform: translateY(4px); }',
    '#gate .gate-card { width: 100%; max-width: 360px; background: #fff; padding: 28px 26px;',
    '  box-shadow: 0 2px 8px rgba(0,0,0,0.05); box-sizing: border-box; }',
    // The one line on the card is the input's own label
    '#gate label { display: block; font-size: 18px; font-weight: 700; line-height: 1.35;',
    '  margin: 0 0 14px; color: #0C2749; }',
    '#gate .gate-row { display: flex; gap: 10px; }',
    '#gate input { flex: 1; min-width: 0; height: 46px; padding: 0 14px; font: inherit; font-size: 18px;',
    '  letter-spacing: 4px; border: 1px solid #e7e3d5; background: #f7f5ee; color: #0C2749; }',
    '#gate input:focus { outline: none; border-color: #0C2749; background: #fff; }',
    '#gate button { height: 46px; padding: 0 20px; border: none; background: #0C2749; color: #fff;',
    '  font: inherit; font-weight: 700; cursor: pointer; }',
    '#gate button:hover { background: #000e35; }',
    '#gate .gate-error { color: #AA1120; font-size: 13px; font-weight: 600; margin: 12px 0 0; }',
    '#gate .gate-disclosure { font-size: 12px; line-height: 1.6; color: #6b7280; text-align: center; }',
    '#gate .gate-disclosure b { color: #0C2749; }',
    '#gate .gate-disclosure a { color: inherit; }',
  ].join('\n');
  document.head.appendChild(css);

  function sha256(text) {
    var bytes = new TextEncoder().encode(text);
    return crypto.subtle.digest('SHA-256', bytes).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) {
        return ('0' + b.toString(16)).slice(-2);
      }).join('');
    });
  }

  function build() {
    var gate = document.createElement('div');
    gate.id = 'gate';
    // The lockup carries REMAX branding, so the office disclosure the brand
    // rules require on any branded page sits under the card, matching the
    // footer on every page.
    gate.innerHTML =
      '<div class="gate-lockup"><img src="remax-logo.png" alt="REMAX" width="1112" height="308" /><span>Alliance</span></div>' +
      '<div class="gate-card" role="dialog" aria-modal="true" aria-labelledby="gateTitle">' +
        '<form>' +
          '<label id="gateTitle" for="gateCode">Enter the access code</label>' +
          '<div class="gate-row">' +
            '<input id="gateCode" type="password" inputmode="numeric" autocomplete="off" autocapitalize="off" spellcheck="false" />' +
            '<button type="submit">Open</button>' +
          '</div>' +
          '<p class="gate-error" id="gateError" role="alert" hidden>That code is not right. Try again.</p>' +
        '</form>' +
      '</div>' +
      '<div class="gate-disclosure"><b>REMAX Alliance</b><br />' +
        '8900 N Dixie Dr, Dayton, OH 45414 &middot; <a href="tel:+19378984400">(937) 898-4400</a><br />' +
        '<a href="mailto:mike.seagraves@remax.net">mike.seagraves@remax.net</a> &middot; ' +
        '<a href="https://alliance-vandalia-dayton-oh.remax.com/" target="_blank" rel="noopener">alliance-vandalia-dayton-oh.remax.com</a><br />' +
        'Each Office Independently Owned and Operated.</div>';
    document.body.appendChild(gate);

    var input = gate.querySelector('#gateCode');
    var error = gate.querySelector('#gateError');
    input.focus();
    input.addEventListener('input', function () { error.hidden = true; });
    gate.querySelector('form').addEventListener('submit', function (e) {
      e.preventDefault();
      if (!window.crypto || !crypto.subtle) {
        error.textContent = 'Open this page at https://growatalliance.com to enter the code.';
        error.hidden = false;
        return;
      }
      sha256(input.value.trim()).then(function (hash) {
        if (hash !== HASH) {
          error.hidden = false;
          input.select();
          return;
        }
        // Remembered in this browser; a blocked storage just means asking again
        try { localStorage.setItem(KEY, HASH); } catch (err) {}
        root.classList.remove('gated');
        gate.remove();
      });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
