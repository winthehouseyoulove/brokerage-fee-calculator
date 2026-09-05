// Shared brokerage fee math. Both index.html (plan comparison) and
// planning.html (business plan builder) run these, and tests.html checks them,
// so a fix here reaches every page at once.
(function (global) {
  'use strict';

  // What one year on a plan costs, and what the agent keeps.
  //
  // The split runs at the plan's split rate until the brokerage's share of it
  // reaches the cap, then everything above that is charged at the post-cap
  // rate. Monthly plan fees, MLS dues, per-transaction fees and annual dues sit
  // on top of the split and are not capped.
  //
  //   gci          gross commission income for the year
  //   transactions closed sides
  //   mls          MLS dues per month, charged 12 times
  function compute(plan, gci, transactions, mls) {
    // GCI that fills the cap. A custom plan can be set to a 100% agent split,
    // and 0/0 is NaN, which would poison every figure downstream. No split
    // means the cap can never fill, so the ceiling is infinite.
    const gciToCap = plan.splitRate > 0 ? plan.cap / plan.splitRate : Infinity;
    let splitCost, capMet;
    if (gci <= gciToCap) {
      splitCost = gci * plan.splitRate;
      capMet = false;
    } else {
      const remainingGci = gci - gciToCap;
      splitCost = plan.cap + remainingGci * plan.postCapRate;
      capMet = true;
    }
    const monthlyTotal = plan.monthly * 12;
    const mlsTotal = mls * 12;
    const transactionTotal = plan.perTransaction * transactions;
    const totalCost = splitCost + monthlyTotal + mlsTotal + transactionTotal + plan.annualDues;
    const net = gci - totalCost;
    return { splitCost, monthlyTotal, mlsTotal, transactionTotal, dues: plan.annualDues, totalCost, net, capMet, gciToCap };
  }

  // Fewest whole transactions that still nets the target.
  // A partial deal is not a thing, so this rounds up, which means the agent
  // usually clears the target by the value of that last partial deal.
  function solveRequiredTransactions(plan, targetNet, commissionPct, avgPrice) {
    const commRate = commissionPct / 100;
    if (targetNet <= 0 || commRate <= 0 || avgPrice <= 0) {
      return { gci: 0, volume: 0, transactions: 0, result: null, feasible: false };
    }
    for (let txn = 1; txn <= 10000; txn++) {
      const volume = txn * avgPrice;
      const gci = volume * commRate;
      const result = compute(plan, gci, txn, 0);
      if (result.net >= targetNet) {
        return { gci, volume, transactions: txn, result, feasible: true };
      }
    }
    return { gci: 0, volume: 0, transactions: 0, result: null, feasible: false };
  }

  // Plan terms from the REMAX Alliance fee sheet dated 08/27/2026.
  // Monthly is the plan fee only; MLS dues are entered separately.
  const PLANS = {
    noStress: {
      key: 'no-stress', name: 'No Stress Plan', color: 'red',
      monthly: 50, annualDues: 410, perTransaction: 199,
      splitRate: 0.20, cap: 17000, postCapRate: 0.05,
    },
    executive: {
      key: 'executive', name: 'Executive Plan', color: 'blue',
      monthly: 500, annualDues: 410, perTransaction: 199,
      splitRate: 0.10, cap: 9000, postCapRate: 0.05,
    },
  };

  global.FeeMath = { compute, solveRequiredTransactions, PLANS };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.FeeMath;
