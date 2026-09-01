// Checks on the fee math in fee-math.js. Runs in the browser via tests.html
// and on the command line with `node tests.js`.
//
// Expected figures are worked by hand from the RE/MAX Alliance fee sheet dated
// 08/27/2026, not copied out of the code, so a change to the math breaks a test
// instead of quietly moving the answer.
(function (global) {
  'use strict';

  const FM = global.FeeMath || require('./fee-math.js');
  const OT = global.OhioTax || require('./ohio-tax.js');
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

  // ---------- Ohio tax estimate ----------
  // Worked by hand from the sources cited in ohio-tax.js.
  test('Ohio tax', 'A single agent on $100,000 of profit in a 2.25% city', () => {
    const r = OT.estimate(100000, { filingStatus: 'single', cityRate: 2.25 });
    // 92.35% of 100,000 is 92,350 of net earnings
    eq(r.socialSecurity, 92350 * 0.124, 'Social Security');   // 11,451.40
    eq(r.medicare, 92350 * 0.029, 'Medicare');                // 2,678.15
    eq(r.additionalMedicare, 0, 'Additional Medicare');
    eq(r.seTax, 14129.55, 'self-employment tax');
    // AGI 92,935.23, less the 16,100 standard deduction, is 76,835.23 taxable
    eq(r.federalTax, 1240 + 4560 + 0.22 * (76835.225 - 50400), 'federal tax'); // 11,615.75
    eq(r.ohioTax, 0, 'Ohio tax');
    eq(r.cityTax, 2250, 'city tax');
    eq(r.total, 27995.30, 'total tax');
    ok(Math.abs(r.effectiveRate - 0.2800) < 0.0005, `effective rate came out ${r.effectiveRate}`);
  });

  test('Ohio tax', 'Social Security stops at the wage base, Medicare does not', () => {
    const base = OT.SE.socialSecurityWageBase;               // 184,500 for 2026
    const atCap = OT.estimate(base / 0.9235, { filingStatus: 'single' });
    const wayOver = OT.estimate(600000, { filingStatus: 'single' });
    eq(atCap.socialSecurity, base * 0.124, 'Social Security at the cap');
    eq(wayOver.socialSecurity, base * 0.124, 'Social Security far above the cap');
    ok(wayOver.medicare > atCap.medicare * 2, 'Medicare should keep climbing');
  });

  test('Ohio tax', 'Additional Medicare starts at the filing threshold, not before', () => {
    const under = OT.estimate(200000, { filingStatus: 'single' });   // 184,700 of net earnings
    const over = OT.estimate(300000, { filingStatus: 'single' });
    eq(under.additionalMedicare, Math.max(0, 200000 * 0.9235 - 200000) * 0.009, 'below the threshold');
    eq(over.additionalMedicare, (300000 * 0.9235 - 200000) * 0.009, 'above the threshold');
    const mfj = OT.estimate(300000, { filingStatus: 'mfj' });
    eq(mfj.additionalMedicare, (300000 * 0.9235 - 250000) * 0.009, 'joint threshold is higher');
  });

  test('Ohio tax', 'Ohio charges nothing until business income passes the deduction', () => {
    eq(OT.estimate(150000, { filingStatus: 'single' }).ohioTax, 0, 'Ohio tax at $150,000');
    eq(OT.estimate(250000, { filingStatus: 'single' }).ohioTax, 0, 'Ohio tax at the deduction');
    eq(OT.estimate(300000, { filingStatus: 'single' }).ohioTax, 50000 * 0.03, 'Ohio tax above it');
  });

  test('Ohio tax', 'City tax is charged on every dollar of profit', () => {
    [50000, 400000].forEach(profit => {
      const none = OT.estimate(profit, { filingStatus: 'single', cityRate: 0 });
      const taxed = OT.estimate(profit, { filingStatus: 'single', cityRate: 2 });
      eq(taxed.cityTax - none.cityTax, profit * 0.02, `city tax on ${profit}`);
    });
  });

  test('Ohio tax', 'QBI is off unless asked for, and lowers the bill when on', () => {
    const off = OT.estimate(120000, { filingStatus: 'single' });
    const on = OT.estimate(120000, { filingStatus: 'single', qbi: true });
    eq(off.qbiDeduction, 0, 'QBI when not asked for');
    ok(on.qbiDeduction > 0, 'QBI when asked for');
    ok(on.federalTax < off.federalTax, 'QBI should lower federal tax');
    eq(on.seTax, off.seTax, 'QBI must not touch self-employment tax');
  });

  test('Ohio tax', 'Grossing up inverts the estimate at every size', () => {
    [20000, 80000, 150000, 400000].forEach(target => {
      const opts = { filingStatus: 'mfj', cityRate: 2.25 };
      const gross = OT.grossUp(target, opts);
      const back = OT.estimate(gross, opts).takeHome;
      ok(Math.abs(back - target) < 1, `grossing up ${target} came back as ${back}`);
    });
  });

  test('Ohio tax', 'Every figure adds up, and earning more never nets less', () => {
    let prev = -Infinity;
    for (let profit = 0; profit <= 500000; profit += 10000) {
      const r = OT.estimate(profit, { filingStatus: 'single', cityRate: 2.25 });
      eq(r.total, r.seTax + r.federalTax + r.ohioTax + r.cityTax, `total at ${profit}`);
      eq(r.takeHome, profit - r.total, `take-home at ${profit}`);
      ok(r.takeHome >= prev, `take-home fell at ${profit}`);
      prev = r.takeHome;
    }
  });

  // ---------- S corporation election ----------
  test('S corporation', 'An LLC on its own changes nothing: it is the sole proprietor case', () => {
    // A single-member LLC is a disregarded entity, so there is no separate
    // option to model. This pins that: 'sole' covers both.
    const a = OT.estimate(120000, { filingStatus: 'single', cityRate: 2 });
    const b = OT.estimate(120000, { filingStatus: 'single', cityRate: 2, entity: 'sole' });
    eq(a.total, b.total, 'total');
    eq(a.seTax, b.seTax, 'self-employment tax');
  });

  test('S corporation', 'FICA reaches the wage only, not the distribution', () => {
    const wage = 60000;
    const r = OT.estimate(150000, { filingStatus: 'single', cityRate: 2, entity: 'scorp', wage });
    const half = wage * (OT.FICA.socialSecurity + OT.FICA.medicare);   // 7.65% each side
    eq(r.employerFica, half, 'employer half');
    eq(r.employeeFica, half, 'employee half');
    eq(r.payrollTax, half * 2, 'payroll tax');
    // A sole proprietor on the same profit pays on 92.35% of all of it
    const sole = OT.estimate(150000, { filingStatus: 'single', cityRate: 2 });
    ok(sole.seTax > r.payrollTax, 'the election should cut the payroll tax, not raise it');
  });

  test('S corporation', 'Paying the whole profit as wages is worse than not electing at all', () => {
    const profit = 120000;
    const all = OT.estimate(profit, { filingStatus: 'single', cityRate: 2, entity: 'scorp', wage: profit });
    eq(all.distribution, 0, 'distribution');
    const sole = OT.estimate(profit, { filingStatus: 'single', cityRate: 2 });
    // Self-employment tax runs on 92.35% of profit; payroll tax runs on the
    // whole wage. With no distribution the election buys nothing and costs the
    // difference, which is exactly that 92.35%.
    eq(all.payrollTax, sole.seTax / OT.SE.netEarningsRate, 'payroll tax on the full wage');
    ok(all.payrollTax > sole.seTax, 'so it should be higher, not lower');
  });

  test('S corporation', 'A wage above the profit is capped at the profit', () => {
    const r = OT.estimate(50000, { filingStatus: 'single', cityRate: 2, entity: 'scorp', wage: 500000 });
    eq(r.wage, 50000, 'wage');
    eq(r.distribution, 0, 'distribution');
  });

  test('S corporation', 'Social Security still stops at the wage base', () => {
    const base = OT.SE.socialSecurityWageBase;
    const r = OT.estimate(600000, { filingStatus: 'single', cityRate: 2, entity: 'scorp', wage: 400000 });
    eq(r.employerFica, base * OT.FICA.socialSecurity + 400000 * OT.FICA.medicare, 'employer half');
  });

  test('S corporation', 'Ohio still covers the wage, since it is business income for the owner', () => {
    const under = OT.estimate(200000, { filingStatus: 'single', cityRate: 2, entity: 'scorp', wage: 80000 });
    eq(under.ohioTax, 0, 'Ohio tax below the deduction');
    const over = OT.estimate(400000, { filingStatus: 'single', cityRate: 2, entity: 'scorp', wage: 150000 });
    eq(over.ohioTax, Math.max(0, over.agi - 250000) * 0.03, 'Ohio tax above it');
  });

  test('S corporation', 'The city taxes the wage plus the corporation profit, not the whole profit', () => {
    const profit = 150000, wage = 60000;
    const r = OT.estimate(profit, { filingStatus: 'single', cityRate: 2, entity: 'scorp', wage });
    eq(r.cityTax, (r.wage + r.distribution) * 0.02, 'city tax');
    // Lower than the sole proprietor base by the employer half, which the
    // corporation deducts before the distribution.
    const sole = OT.estimate(profit, { filingStatus: 'single', cityRate: 2 });
    ok(r.cityTax < sole.cityTax, 'the city base should be a little smaller');
  });

  test('S corporation', 'Running costs are part of the bill, so a small profit is not worth it', () => {
    const free = OT.estimate(90000, { filingStatus: 'single', cityRate: 2, entity: 'scorp', wage: 60000 });
    const costly = OT.estimate(90000, { filingStatus: 'single', cityRate: 2, entity: 'scorp', wage: 60000, entityCost: 2500 });
    ok(costly.total > free.total, 'the cost should raise the bill');
    ok(costly.takeHome < free.takeHome, 'and lower what is kept');
  });

  test('S corporation', 'Every figure adds up, and grossing up still inverts', () => {
    const opts = { filingStatus: 'mfj', cityRate: 2.25, entity: 'scorp', wage: 70000, entityCost: 1500 };
    [100000, 200000, 400000].forEach(profit => {
      const r = OT.estimate(profit, opts);
      eq(r.total, r.payrollTax + r.federalTax + r.ohioTax + r.cityTax + r.entityCost, `total at ${profit}`);
      eq(r.takeHome, profit - r.total, `take-home at ${profit}`);
    });
    [60000, 150000].forEach(target => {
      const gross = OT.grossUp(target, opts);
      ok(Math.abs(OT.estimate(gross, opts).takeHome - target) < 1, `grossing up ${target}`);
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
