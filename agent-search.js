// The agent lookup both pages open with. One copy, so the two cannot drift
// apart again: the same roster, the same matching, the same figures in the
// field. Each page decides what picking or clearing an agent does to its own
// numbers; the agent itself is shared between the pages through share.js.
(function (global) {
  'use strict';

  const MAX_RESULTS = 50;
  const money = n => '$' + Math.round(n).toLocaleString('en-US');

  // An agent with no closings has no production to fill in and no average sale.
  let roster = null;
  function agents() {
    if (!roster) {
      roster = (global.__AGENTS__ || [])
        .filter(a => a.units > 0 && a.volume > 0)
        .sort((a, b) => a.name.localeCompare(b.name));
    }
    return roster;
  }

  function find(name) {
    return name ? agents().find(a => a.name === name) || null : null;
  }

  // The agent's own average sale price: volume over units as the MLS records
  // them, halves included, to the dollar. Both pages and the field itself use
  // this one figure, so the same agent never shows two averages.
  function avgSale(agent) {
    return Math.round(agent.volume / agent.units);
  }

  const unitsText = n => n + (n === 1 ? ' unit' : ' units');

  // Safari fills anything that looks like a name field from the user's own
  // contact card, and ignores autocomplete="off" there. type="search", this
  // name and a placeholder that never says "your name" are as far as a page
  // can push back.
  const MARKUP = `
    <div class="agent-input">
      <input type="search" id="agentSearch" name="mls-agent-lookup"
             placeholder="Search an agent to fill in their 2025 production"
             autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"
             role="combobox" aria-expanded="false" aria-autocomplete="list" aria-controls="agentResults" />
      <span class="agent-inline" id="agentInline" hidden></span>
      <button type="button" class="agent-clear" id="agentClear" aria-label="Clear the agent" hidden>&times;</button>
    </div>
    <div class="agent-results" id="agentResults"></div>`;

  //   root      the .agent-search element to build the lookup inside
  //   onSelect  called with the agent the reader picked
  //   onClear   called when the reader clears the box with the x
  // Returns show(agent), which fills the box without calling either, for
  // restoring an agent the other page or a saved plan already chose.
  function mount(root, opts) {
    root.innerHTML = MARKUP;
    const input = root.querySelector('#agentSearch');
    const inline = root.querySelector('#agentInline');
    const clearBtn = root.querySelector('#agentClear');
    const results = root.querySelector('#agentResults');
    let activeIndex = -1;
    let total = 0;

    function filter(q) {
      q = q.trim().toLowerCase();
      const hits = q
        ? agents().filter(a => a.name.toLowerCase().includes(q) || (a.office || '').toLowerCase().includes(q))
        : agents();
      total = hits.length;
      return hits.slice(0, MAX_RESULTS);
    }

    function open(matches) {
      results.innerHTML = matches.length
        ? matches.map((a, i) => `
            <div class="agent-result${i === activeIndex ? ' active' : ''}" data-index="${i}">
              <span class="ar-who">
                <span class="ar-name">${a.name}</span>
                <span class="ar-office">${a.office || ''}</span>
              </span>
              <span class="ar-stats">${unitsText(a.units)} · ${money(a.volume)}</span>
            </div>`).join('')
          + (total > matches.length
            ? `<div class="agent-result ar-more">Showing ${matches.length} of ${total}, keep typing to narrow</div>`
            : '')
        : '<div class="agent-result"><span class="ar-empty">No matches</span></div>';
      results.classList.add('open');
      input.setAttribute('aria-expanded', 'true');
    }

    function close() {
      results.classList.remove('open');
      input.setAttribute('aria-expanded', 'false');
    }

    // The x is there whenever there is text to clear, matched agent or not.
    // Safari filling the box uninvited is exactly when it is wanted most.
    function syncClear() { clearBtn.hidden = input.value.trim() === ''; }

    // The matched agent's figures ride inside the field. The input is padded
    // to whatever they take so a typed name cannot run under them; a hidden
    // span measures zero, leaving room for just the x.
    function showFigures(agent) {
      inline.hidden = !agent;
      inline.innerHTML = agent
        ? `<span><b>${agent.units}</b> ${agent.units === 1 ? 'unit' : 'units'}</span>`
          + `<span><b>${money(agent.volume)}</b> volume</span>`
          + `<span><b>${money(avgSale(agent))}</b> avg sale</span>`
        : '';
      input.style.paddingRight = (inline.offsetWidth + 48) + 'px';
    }

    function show(agent) {
      input.value = agent ? agent.name : '';
      showFigures(agent);
      syncClear();
      close();
    }

    function pick(agent) {
      activeIndex = -1;
      show(agent);
      opts.onSelect(agent);
    }

    input.addEventListener('input', () => {
      activeIndex = -1;
      showFigures(null);
      syncClear();
      open(filter(input.value));
    });
    input.addEventListener('focus', () => {
      activeIndex = -1;
      open(filter(input.value));
    });
    input.addEventListener('keydown', (e) => {
      const matches = filter(input.value);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        activeIndex = Math.min(activeIndex + 1, matches.length - 1);
        open(matches);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        activeIndex = Math.max(activeIndex - 1, 0);
        open(matches);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const hit = matches[activeIndex >= 0 ? activeIndex : 0];
        if (hit) pick(hit);
      } else if (e.key === 'Escape') {
        close();
      }
    });
    results.addEventListener('click', (e) => {
      const item = e.target.closest('.agent-result');
      if (!item || item.dataset.index === undefined) return;
      const hit = filter(input.value)[Number(item.dataset.index)];
      if (hit) pick(hit);
    });
    clearBtn.addEventListener('click', () => {
      show(null);
      opts.onClear();
    });
    document.addEventListener('click', (e) => {
      if (!root.contains(e.target)) close();
    });
    syncClear();

    return { show };
  }

  global.AgentSearch = { mount, find, avgSale };
})(window);
