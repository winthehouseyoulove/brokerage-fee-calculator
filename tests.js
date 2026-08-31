// Checks on the fee math in fee-math.js. Runs in the browser via tests.html
// and on the command line with `node tests.js`.
//
// Expected figures are worked by hand from the RE/MAX Alliance fee sheet dated
// 08/27/2026, not copied out of the code, so a change to the math breaks a test
// instead of quietly moving the answer.
(function (global) {
  'use strict';

  const FM = global.FeeMath || require('./fee-math.js');
  const NO_STRESS = FM.PLANS.noStress;   // 80/20, $17,000 cap, then 95/5, $50/mo
  const EXECUTIVE = FM.PLANS.executive;  // 90/10, $9,000 cap, then 95/5, $500/mo

  // What an agent would pay on their old brokerage: flat 70/30, no cap.
  const CUSTOM = {
    key: 'custom', name: 'Custom Plan', editable: true,
    monthly: 300, annualDues: 0, perTransaction: 100,
    splitRate: 0.30, cap: 0, postCapRate: 0.30,
  };

  const cases = [];
  const test = (group, name, fn) => cases.push({ group, name, fn });

  function eq(actual, expected, label) {
    const a = Math.round(actual * 100) / 100;
    const e = Math.round(expected * 100) / 100;
    if (a !== e) throw new Error(`${label}: got ${a}, expected ${e}`);
  }
  const ok = (cond, label) => { if (!cond) throw new Error(label); };

  // ---------- The split, below the cap ----------
  test('Split', 'No Stress below the cap takes 20% of GCI', () => {
    const r = FM.compute(NO_STRESS, 50000, 10, 0);
    eq(r.splitCost, 10000, 'split');
    eq(r.gciToCap, 85000, 'GCI needed to cap');
    ok(!r.capMet, 'cap should not be met at $50,000 of GCI');
  });

  test('Split', 'Executive below the cap takes 10% of GCI', () => {
    const r = FM.compute(EXECUTIVE, 50000, 10, 0);
    eq(r.splitCost, 5000, 'split');
    eq(r.gciToCap, 90000, 'GCI needed to cap');
    ok(!r.capMet, 'cap should not be met at $50,000 of GCI');
  });

  // ---------- The cap ----------
  test('Cap', 'No Stress caps at exactly $17,000 of split', () => {
    const r = FM.compute(NO_STRESS, 85000, 15, 50);
    eq(r.splitCost, 17000, 'split at the cap');
  });

  test('Cap', 'Executive caps at exactly $9,000 of split', () => {
    const r = FM.compute(EXECUTIVE, 90000, 15, 50);
    eq(r.splitCost, 9000, 'split at the cap');
  });

  test('Cap', 'A dollar past the cap is charged at 5%, not the split rate', () => {
    const atCap = FM.compute(NO_STRESS, 85000, 15, 0);
    const past = FM.compute(NO_STRESS, 85001, 15, 0);
    eq(past.splitCost - atCap.splitCost, 0.05, 'the marginal dollar');
    ok(past.capMet, 'cap should read as met above $85,000');
  });

  test('Cap', 'No Stress past the cap: $17,000 plus 5% of the rest', () => {
    const r = FM.compute(NO_STRESS, 185000, 25, 50);
    eq(r.splitCost, 17000 + 100000 * 0.05, 'split');       // 22,000
    eq(r.totalCost, 22000 + 600 + 600 + 4975 + 410, 'total cost');
    eq(r.net, 185000 - (22000 + 600 + 600 + 4975 + 410), 'net'); // 156,415
  });

  test('Cap', 'Executive past the cap: $9,000 plus 5% of the rest', () => {
    const r = FM.compute(EXECUTIVE, 190000, 25, 50);
    eq(r.splitCost, 9000 + 100000 * 0.05, 'split');        // 14,000
    eq(r.totalCost, 14000 + 6000 + 600 + 4975 + 410, 'total cost');
    eq(r.net, 190000 - (14000 + 6000 + 600 + 4975 + 410), 'net'); // 164,015
  });

  test('Cap', 'The split never exceeds the cap plus 5% of everything above it', () => {
    [NO_STRESS, EXECUTIVE].forEach(plan => {
      for (let gci = 0; gci <= 1000000; gci += 10000) {
        const r = FM.compute(plan, gci, 20, 0);
        const ceiling = plan.cap + Math.max(0, gci - plan.cap / plan.splitRate) * plan.postCapRate;
        ok(r.splitCost <= ceiling + 0.01, `${plan.name} at ${gci} paid ${r.splitCost}, over ${ceiling}`);
      }
    });
  });

  // ---------- The flat fees ----------
  test('Fees', 'Monthly plan fees and MLS dues are both charged 12 times', () => {
    const r = FM.compute(NO_STRESS, 100000, 10, 50);
    eq(r.monthlyTotal, 600, 'plan fee');
    eq(r.mlsTotal, 600, 'MLS dues');
  });

  test('Fees', 'MLS is not capped: $50/mo more costs $600 more at any volume', () => {
    [50000, 500000].forEach(gci => {
      const base = FM.compute(NO_STRESS, gci, 20, 0);
      const withMls = FM.compute(NO_STRESS, gci, 20, 50);
      eq(base.net - withMls.net, 600, `net difference at ${gci} of GCI`);
    });
  });

  test('Fees', 'Transaction fees scale with the deal count', () => {
    const r = FM.compute(NO_STRESS, 100000, 25, 0);
    eq(r.transactionTotal, 25 * 199, 'transaction fees');
  });

  // ---------- The identities that must always hold ----------
  test('Identities', 'Total cost is the sum of its parts, and net is GCI minus it', () => {
    [NO_STRESS, EXECUTIVE, CUSTOM].forEach(plan => {
      [0, 25000, 85000, 300000].forEach(gci => {
        const r = FM.compute(plan, gci, 12, 45);
        eq(r.totalCost, r.splitCost + r.monthlyTotal + r.mlsTotal + r.transactionTotal + r.dues, `${plan.name} total at ${gci}`);
        eq(r.net, gci - r.totalCost, `${plan.name} net at ${gci}`);
      });
    });
  });

  test('Identities', 'Earning more never nets less', () => {
    [NO_STRESS, EXECUTIVE].forEach(plan => {
      let prev = -Infinity;
      for (let gci = 0; gci <= 600000; gci += 5000) {
        const net = FM.compute(plan, gci, 20, 50).net;
        ok(net >= prev, `${plan.name} net fell at ${gci} of GCI`);
        prev = net;
      }
    });
  });

  test('Identities', 'Every figure is a real number, including a 100% custom split', () => {
    const flat = Object.assign({}, CUSTOM, { splitRate: 0, cap: 0, postCapRate: 0 });
    const r = FM.compute(flat, 250000, 20, 50);
    Object.keys(r).forEach(k => {
      if (typeof r[k] === 'number') ok(Number.isFinite(r[k]) || k === 'gciToCap', `${k} came back as ${r[k]}`);
    });
    eq(r.splitCost, 0, 'split on a 100% plan');
  });

  // ---------- Custom plan ----------
  test('Custom plan', 'A flat 70/30 with no cap charges 30% at every volume', () => {
    const r = FM.compute(CUSTOM, 100000, 10, 0);
    eq(r.splitCost, 30000, 'split');
    eq(r.totalCost, 30000 + 3600 + 1000, 'total cost');
    eq(r.net, 100000 - 34600, 'net');
    const big = FM.compute(CUSTOM, 400000, 10, 0);
    eq(big.splitCost, 120000, 'split at four times the GCI');
  });

  // ---------- Which plan wins ----------
  test('Crossover', 'No Stress wins small years, Executive wins big ones, and they cross once', () => {
    let flips = 0, prevWinner = null;
    for (let gci = 20000; gci <= 400000; gci += 1000) {
      const txn = Math.max(1, Math.round(gci / 8700)); // ~$290,000 sale at 3%
      const a = FM.compute(NO_STRESS, gci, txn, 50).net;
      const b = FM.compute(EXECUTIVE, gci, txn, 50).net;
      const winner = a >= b ? 'no-stress' : 'executive';
      if (prevWinner && winner !== prevWinner) flips++;
      prevWinner = winner;
    }
    ok(FM.compute(NO_STRESS, 20000, 2, 50).net > FM.compute(EXECUTIVE, 20000, 2, 50).net, 'No Stress should win at $20,000 of GCI');
    ok(FM.compute(EXECUTIVE, 400000, 46, 50).net > FM.compute(NO_STRESS, 400000, 46, 50).net, 'Executive should win at $400,000 of GCI');
    eq(flips, 1, 'number of times the winner changes');
  });

  // ---------- The solver behind the business plan ----------
  test('Solver', 'Returns the fewest whole deals that still clears the target', () => {
    const target = 80000;
    [NO_STRESS, EXECUTIVE].forEach(plan => {
      const s = FM.solveRequiredTransactions(plan, target, 3, 290000);
      ok(s.feasible, `${plan.name} should be solvable`);
      ok(s.result.net >= target, `${plan.name} lands at ${s.result.net}, under the target`);
      const oneFewer = FM.compute(plan, (s.transactions - 1) * 290000 * 0.03, s.transactions - 1, 0);
      ok(oneFewer.net < target, `${plan.name} at ${s.transactions - 1} deals already clears the target`);
    });
  });

  test('Solver', 'Volume, GCI and deal count agree with each other', () => {
    const s = FM.solveRequiredTransactions(NO_STRESS, 120000, 2.5, 315000);
    eq(s.volume, s.transactions * 315000, 'volume');
    eq(s.gci, s.volume * 0.025, 'GCI');
  });

  test('Solver', 'Nothing to solve for returns not feasible instead of a number', () => {
    [[0, 3, 290000], [80000, 0, 290000], [80000, 3, 0]].forEach(([t, c, p]) => {
      const s = FM.solveRequiredTransactions(NO_STRESS, t, c, p);
      ok(!s.feasible, `target ${t}, commission ${c}, price ${p} should not be feasible`);
      eq(s.transactions, 0, 'transactions');
    });
  });

  function run() {
    return cases.map(c => {
      try { c.fn(); return { group: c.group, name: c.name, passed: true }; }
      catch (e) { return { group: c.group, name: c.name, passed: false, error: e.message }; }
    });
  }

  global.FeeMathTests = { run };
  if (typeof module !== 'undefined' && module.exports) module.exports = { run };

  // Command line: print the results and exit non-zero on a failure.
  if (typeof process !== 'undefined' && process.argv && process.argv[1] && /tests\.js$/.test(process.argv[1])) {
    const results = run();
    results.forEach(r => console.log(`${r.passed ? 'PASS' : 'FAIL'}  ${r.group} — ${r.name}${r.passed ? '' : '\n      ' + r.error}`));
    const failed = results.filter(r => !r.passed).length;
    console.log(`\n${results.length - failed}/${results.length} passed`);
    process.exit(failed ? 1 : 0);
  }
})(typeof window !== 'undefined' ? window : globalThis);
