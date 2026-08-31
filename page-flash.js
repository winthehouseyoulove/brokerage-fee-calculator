// The two pages are separate documents, so a transition between them has to
// span a navigation: the mark fades up over the page being left, and is
// already up when the next one paints, so it reads as one flash rather than
// two. Runs from <head> so the incoming page never shows content first.
(function () {
  'use strict';

  var KEY = 'remax-page-flash';
  var root = document.documentElement;

  function reduced() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  function flag(value) {
    try {
      if (value === null) sessionStorage.removeItem(KEY);
      else if (value === undefined) return sessionStorage.getItem(KEY) === '1';
      else sessionStorage.setItem(KEY, '1');
    } catch (e) {
      return false;
    }
  }

  // Arrived from the other page: paint over it before anything else renders.
  var arriving = flag() && !reduced();
  if (arriving) root.classList.add('flashing');

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  ready(function () {
    var flash = document.getElementById('pageFlash');
    flag(null);

    function hide() {
      root.classList.remove('flashing');
      if (flash) flash.classList.remove('is-on');
    }

    // Hold the mark briefly so the flash is legible, then let the CSS fade it.
    if (arriving) setTimeout(hide, 160);

    // Coming back through history can restore the page mid-flash.
    window.addEventListener('pageshow', function (e) { if (e.persisted) hide(); });

    document.querySelectorAll('.top-nav a').forEach(function (link) {
      link.addEventListener('click', function (e) {
        // Leave modified clicks alone: they open tabs and windows.
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        var href = link.getAttribute('href');
        if (!href || /^https?:/i.test(href) || link.classList.contains('active')) return;
        e.preventDefault();
        flag(true);
        if (!flash || reduced()) { window.location.href = link.href; return; }
        flash.classList.add('is-on');
        // Long enough to read as a flash, short enough not to feel like a wait.
        setTimeout(function () { window.location.href = link.href; }, 190);
      });
    });
  });
})();
