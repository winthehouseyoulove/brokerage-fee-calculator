// Ballpark income tax for a self-employed real estate agent in Ohio.
//
// Every figure below is quoted from a primary source, with the source and the
// date it was checked. Nothing here is from memory. This is an estimate for
// planning, not a return: it models one household whose only earned income is
// the agent's Schedule C profit, and it does not handle Head of Household,
// itemised deductions, credits, other wages, or a spouse's withholding.
//
// SOURCES, all checked 08/31/2026:
//
//  Federal brackets and standard deduction, tax year 2026
//    IRS IR-2025-103, published 10/09/2025
//    irs.gov/newsroom/irs-releases-tax-inflation-adjustments-for-tax-year-2026-including-amendments-from-the-one-big-beautiful-bill
//
//  Self-employment tax: 15.3% total, 12.4% Social Security and 2.9% Medicare,
//  charged on 92.35% of net earnings; Medicare uncapped; Additional Medicare
//  Tax of 0.9% over $200,000 (single) and $250,000 (married filing jointly);
//  one-half of self-employment tax deductible
//    IRS Topic no. 554, updated 05/26/2026 — irs.gov/taxtopics/tc554
//
//  Social Security wage base for 2026: $184,500
//    SSA Contribution and Benefit Base — ssa.gov/oact/cola/cbb.html
//
//  Ohio: business income above the Business Income Deduction is taxed at a
//  flat 3%. The deduction is up to $250,000 for single or married filing
//  jointly, $125,000 for married filing separately.
//    Ohio Department of Taxation, Business Income Deduction Information
//    tax.ohio.gov/individual/Business-Income-Deduction
//
//  Ohio municipal rates vary by city and are entered by the user.
//    RITA Tax Rates Table — ritaohio.com/TaxRatesTable
//
//  S corporation election, all checked 08/31/2026:
//    A single-member LLC that has not elected corporate treatment changes
//    nothing here. The IRS treats it as a disregarded entity, and "an
//    individual owner of a single-member LLC that operates a trade or business
//    is subject to the tax on net earnings from self employment in the same
//    manner as a sole proprietorship"
//    irs.gov/businesses/small-businesses-self-employed/single-member-limited-liability-companies
//
//    Ohio still covers the owner's wages with the Business Income Deduction.
//    Compensation paid by a pass-through entity to an investor holding at least
//    20% is "reclassified as business income under Ohio law. Thus, they are
//    eligible for the Business Income Deduction" (R.C. 5733.40(A)(7))
//    tax.ohio.gov FAQ, Business Income and the Business Income Deduction
//
//    The city is close to a wash. A shareholder's distributive share of S
//    corporation net profit is exempt from municipal income tax under
//    R.C. 718.01(C)(14)(a), but the corporation pays municipal net profit tax
//    on that same money, so the base is the wage plus the corporation's net
//    profit. Divisions (C)(14)(b) and (c) let municipalities that voted for it
//    in 2003 or 2004 keep taxing the distributive share as well; this model
//    does not know which those are, and in one of them the city bill would be
//    higher than shown.
//    codes.ohio.gov/ohio-revised-code/section-718.01
//
//  UNVERIFIED, and deliberately excluded:
//  The Qualified Business Income deduction. The IRS page (updated 05/12/2026)
//  still reads "for tax years beginning after December 31, 2017, and ending on
//  or before December 31, 2025", so under the primary source it does not reach
//  tax year 2026. Excluding it is the conservative direction: if a CPA says it
//  applies, the real bill is lower than this. Pass qbi:true to model it.
(function (global) {
  'use strict';

  const SE = {
    netEarningsRate: 0.9235,
    socialSecurityRate: 0.124,
    socialSecurityWageBase: 184500,   // 2026
    medicareRate: 0.029,
    additionalMedicareRate: 0.009,
    additionalMedicareThreshold: { single: 200000, mfj: 250000 },
  };

  // Tax year 2026
  const FEDERAL = {
    standardDeduction: { single: 16100, mfj: 32200 },
    brackets: {
      single: [
        [12400, 0.10], [50400, 0.12], [105700, 0.22], [201775, 0.24],
        [256225, 0.32], [640600, 0.35], [Infinity, 0.37],
      ],
      mfj: [
        [24800, 0.10], [100800, 0.12], [211400, 0.22], [403550, 0.24],
        [512450, 0.32], [768700, 0.35], [Infinity, 0.37],
      ],
    },
  };

  const OHIO = {
    businessIncomeDeduction: { single: 250000, mfj: 250000 },
    businessIncomeRate: 0.03,
  };

  const QBI_RATE = 0.20;

  // The employee and employer halves of FICA are each half of the 15.3%
  // self-employment rate, charged on wages rather than on 92.35% of profit.
  const FICA = { socialSecurity: 0.062, medicare: 0.0145 };

  function bracketTax(taxable, status) {
    const table = FEDERAL.brackets[status] || FEDERAL.brackets.single;
    let tax = 0, floor = 0;
    for (let i = 0; i < table.length; i++) {
      const ceiling = table[i][0], rate = table[i][1];
      if (taxable <= floor) break;
      tax += (Math.min(taxable, ceiling) - floor) * rate;
      floor = ceiling;
    }
    return tax;
  }

  // netProfit is what the agent keeps after the brokerage and after business
  // expenses: the number their Schedule C, or their corporation's return,
  // would show before the owner is paid.
  //
  // options.entity: 'sole' for a sole proprietor or a single-member LLC, which
  // are the same thing here, or 'scorp' for an S corporation election.
  // options.wage: the owner's W-2 wage under an S corporation. The IRS requires
  // it to be reasonable compensation and there is no formula for that, so it is
  // an input rather than something this file works out.
  // options.entityCost: what running the corporation costs in a year, payroll
  // service and the extra return, which the saving has to clear to be worth it.
  function estimate(netProfit, options) {
    const o = options || {};
    const status = o.filingStatus === 'mfj' ? 'mfj' : 'single';
    const cityRate = Math.max(0, Number(o.cityRate) || 0) / 100;
    const profit = Math.max(0, Number(netProfit) || 0);
    if (o.entity === 'scorp') return estimateScorp(profit, o, status, cityRate);

    // --- Self-employment tax ---
    const seBase = profit * SE.netEarningsRate;
    const socialSecurity = Math.min(seBase, SE.socialSecurityWageBase) * SE.socialSecurityRate;
    const medicare = seBase * SE.medicareRate;
    const over = Math.max(0, seBase - SE.additionalMedicareThreshold[status]);
    const additionalMedicare = over * SE.additionalMedicareRate;
    const seTax = socialSecurity + medicare + additionalMedicare;
    // Only the regular half is deductible; the Additional Medicare Tax is not.
    const seDeduction = (socialSecurity + medicare) / 2;

    // --- Federal income tax ---
    const agi = Math.max(0, profit - seDeduction);
    const qbiDeduction = o.qbi ? Math.max(0, agi - FEDERAL.standardDeduction[status]) * QBI_RATE : 0;
    const federalTaxable = Math.max(0, agi - FEDERAL.standardDeduction[status] - qbiDeduction);
    const federalTax = bracketTax(federalTaxable, status);

    // --- Ohio ---
    // A real estate agent's profit is business income, so the Business Income
    // Deduction covers it up to the cap and the excess is flat-rated. Most
    // agents therefore owe Ohio nothing on it.
    const ohioTaxable = Math.max(0, profit - OHIO.businessIncomeDeduction[status]);
    const ohioTax = ohioTaxable * OHIO.businessIncomeRate;

    // --- City ---
    // Municipal income tax reaches net profit with no equivalent of the
    // Business Income Deduction, so it applies from the first dollar.
    const cityTax = profit * cityRate;

    const total = seTax + federalTax + ohioTax + cityTax;
    return {
      profit, entity: 'sole', wage: 0, distribution: 0, entityCost: 0,
      socialSecurity, medicare, additionalMedicare, seTax, seDeduction,
      agi, qbiDeduction, federalTaxable, federalTax,
      ohioTaxable, ohioTax, cityTax,
      total,
      takeHome: profit - total,
      effectiveRate: profit > 0 ? total / profit : 0,
    };
  }

  // An S corporation pays the owner a wage and hands the rest over as a
  // distribution. FICA reaches the wage only, which is the whole point of the
  // election, and the employer half is a cost of the business that comes out
  // before the distribution.
  function estimateScorp(profit, o, status, cityRate) {
    const wage = Math.max(0, Math.min(Number(o.wage) || 0, profit));
    const entityCost = Math.max(0, Number(o.entityCost) || 0);

    const cappedWage = Math.min(wage, SE.socialSecurityWageBase);
    const employerFica = cappedWage * FICA.socialSecurity + wage * FICA.medicare;
    const employeeFica = cappedWage * FICA.socialSecurity + wage * FICA.medicare;
    const additionalMedicare =
      Math.max(0, wage - SE.additionalMedicareThreshold[status]) * SE.additionalMedicareRate;
    const payrollTax = employerFica + employeeFica + additionalMedicare;

    // What is left after the wage and the employer's half of its payroll tax
    const distribution = Math.max(0, profit - wage - employerFica - entityCost);

    // No half-of-self-employment-tax deduction here: the employer half already
    // came out of the business before the distribution.
    const agi = wage + distribution;
    const qbiDeduction = o.qbi ? Math.max(0, agi - FEDERAL.standardDeduction[status]) * QBI_RATE : 0;
    const federalTaxable = Math.max(0, agi - FEDERAL.standardDeduction[status] - qbiDeduction);
    const federalTax = bracketTax(federalTaxable, status);

    // Ohio: the wage counts as business income for an owner of 20% or more, so
    // the Business Income Deduction still covers both halves.
    const ohioTaxable = Math.max(0, agi - OHIO.businessIncomeDeduction[status]);
    const ohioTax = ohioTaxable * OHIO.businessIncomeRate;

    // The city taxes the wage in the owner's hands and the corporation's net
    // profit in the corporation's, which together are the wage plus the
    // distribution.
    const cityTax = (wage + distribution) * cityRate;

    const total = payrollTax + federalTax + ohioTax + cityTax + entityCost;
    return {
      profit, entity: 'scorp', wage, distribution, entityCost,
      employerFica, employeeFica, additionalMedicare,
      seTax: payrollTax, payrollTax, seDeduction: 0,
      agi, qbiDeduction, federalTaxable, federalTax,
      ohioTaxable, ohioTax, cityTax,
      total,
      takeHome: profit - total,
      effectiveRate: profit > 0 ? total / profit : 0,
    };
  }

  // The planner works backwards from what the household wants to keep, so it
  // needs the profit that nets that amount. Brackets make this un-invertible in
  // closed form, so bisect: take-home rises with profit, which is all a bisect
  // needs. Converges to the cent well inside the iteration cap.
  function grossUp(targetTakeHome, options) {
    const target = Math.max(0, Number(targetTakeHome) || 0);
    if (target <= 0) return 0;
    let lo = target, hi = target * 2 + 1000;
    for (let i = 0; i < 60 && estimate(hi, options).takeHome < target; i++) hi *= 2;
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2;
      if (estimate(mid, options).takeHome < target) lo = mid; else hi = mid;
      if (hi - lo < 0.01) break;
    }
    return hi;
  }

  global.OhioTax = { estimate, grossUp, bracketTax, SE, FEDERAL, OHIO, FICA };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.OhioTax;
