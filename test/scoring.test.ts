import { describe, expect, it } from 'vitest';
import { data, score } from './helpers.js';

describe('report test cases (rules.json)', () => {
  for (const tc of data.rules.testCases) {
    it(tc.name, () => {
      const expected = Object.values(tc.expect).reduce((a, b) => a + b, 0);
      expect(score(tc.team).total).toBe(expected);
    });
  }
});

describe('role cards', () => {
  it('Junior tiers 1/3/7, then +1 each after 3', () => {
    expect(score({ junior_dev: 1 }).total).toBe(1);
    expect(score({ junior_dev: 2 }).total).toBe(3);
    expect(score({ junior_dev: 5 }).total).toBe(7 + 2);
  });

  it('Senior is worth 1 without a Junior and 3 with one', () => {
    expect(score({ senior_dev: 2 }).total).toBe(2);
    expect(score({ senior_dev: 2, junior_dev: 1 }).total).toBe(6 + 1);
  });

  it('Designer tiers 2/5/12', () => {
    expect(score({ designer: 1 }).total).toBe(2);
    expect(score({ designer: 2 }).total).toBe(5);
    expect(score({ designer: 4 }).total).toBe(12);
  });
});

describe('events', () => {
  it('Investors: +1 per role type, +1 more for a full team', () => {
    expect(score({ investors: 1 }).total).toBe(0);
    expect(score({ investors: 1, junior_dev: 1, designer: 1, qa_tester: 1 }).total).toBe(1 + 2 + 3 + 3);
    expect(score({ investors: 1, senior_dev: 1, project_manager: 1, designer: 1, qa_tester: 1 }).total).toBe(1 + 1 + 2 + 3 + 5);
  });

  it('Scope Creep zeroes Coffee, Freelance and Investors', () => {
    const spec = { coffee: 2, freelance: 1, investors: 1, junior_dev: 1, project_manager: 1, designer: 1, qa_tester: 1 };
    expect(score(spec).total).toBe(2 + 2 + 5 + 2 + 1 + 2 + 3);
    expect(score(spec, { crisis: ['scope_creep'] }).total).toBe(2 + 1 + 2 + 3);
  });
});

describe('crisis penalties', () => {
  it('Technical Debt takes 1 per Senior', () => {
    expect(score({ senior_dev: 1, junior_dev: 1 }, { crisis: ['technical_debt'] }).total).toBe(3 + 1 - 1);
  });

  it('Merge Conflict makes every Senior worth 1', () => {
    expect(score({ senior_dev: 2, junior_dev: 1 }, { crisis: ['merge_conflict'] }).total).toBe(2 + 1);
    expect(score({ senior_dev: 1 }, { crisis: ['merge_conflict'] }).total).toBe(1);
  });

  it('Tech Debt Payoff cancels the most costly penalty', () => {
    const r = score({ senior_dev: 3, junior_dev: 1, tech_debt_payoff: 1 }, { crisis: ['merge_conflict', 'technical_debt'] });
    // Cancelling Merge Conflict leaves 9 + 1 - 3 = 7; cancelling Technical Debt leaves 3 + 1 = 4; +2 instead leaves 3 + 1 - 3 + 2 = 3.
    expect(r.total).toBe(7);
  });

  it('Tech Debt Payoff gives +2 when nothing is worth cancelling', () => {
    expect(score({ junior_dev: 1, tech_debt_payoff: 1 }).total).toBe(1 + 2);
    expect(score({ junior_dev: 1, tech_debt_payoff: 1 }, { crisis: ['technical_debt'] }).total).toBe(1 + 2);
  });
});

describe('crisis bonuses', () => {
  it('Unicorn Hype: +3 per role type, +3 more with no unpaired Bug', () => {
    const full = { junior_dev: 1, project_manager: 1, designer: 1, qa_tester: 1 };
    expect(score(full, { crisis: ['unicorn_hype'] }).total).toBe(2 + 1 + 2 + 3 + 15);
    expect(score({ ...full, bug: 1 }, { crisis: ['unicorn_hype'] }).total).toBe(2 + 1 + 2 + 15); // QA pairs with the Bug
    expect(score({ ...full, bug: 2 }, { crisis: ['unicorn_hype'] }).total).toBe(2 + 1 + 2 - 3 + 12);
    expect(score({ designer: 1, bug: 1 }, { crisis: ['unicorn_hype'] }).total).toBe(2 - 3 + 3);
  });

  it('Product Launch: +1 per role type, +1 more with no unpaired Bug, stacking with Unicorn Hype', () => {
    expect(score({ designer: 1, qa_tester: 1 }, { crisis: ['product_launch'] }).total).toBe(2 + 3 + 2 + 1);
    expect(score({ designer: 1 }, { crisis: ['product_launch', 'unicorn_hype'] }).total).toBe(2 + 2 + 6);
  });

  it('Unicorn Rush: +6 with 3 roles and no Bug, Coffee -2 always [P39]', () => {
    expect(score({ junior_dev: 1, designer: 1, qa_tester: 1, coffee: 1 }, { meta: ['unicorn_rush'] }).total).toBe(1 + 2 + 3 + 1 + 6 - 2);
    expect(score({ junior_dev: 1, designer: 1, coffee: 1 }, { meta: ['unicorn_rush'] }).total).toBe(1 + 2 + 1 - 2);
    expect(score({ junior_dev: 1, designer: 1, qa_tester: 1, bug: 2 }, { meta: ['unicorn_rush'] }).total).toBe(1 + 2 - 3);
  });

  it('Viral Success: most Designers +2, others +1', () => {
    expect(score({ designer: 2 }, { crisis: ['viral_success'], others: [{ designer: 1 }] }).total).toBe(5 + 2);
    expect(score({ designer: 1 }, { crisis: ['viral_success'], others: [{ designer: 2 }] }).total).toBe(2 + 1);
  });
});

describe('printed card text matches scoring', () => {
  it('Junior with one PM scores the printed PM row 2/6/14, +2 each after 3, and the PM +1', () => {
    expect([1, 2, 3, 5].map((j) => score({ junior_dev: j, project_manager: 1 }).total)).toEqual([2, 6, 14, 18].map((x) => x + 1));
  });

  it('Agile at Scale: +1 per Junior with a PM', () => {
    expect(score({ junior_dev: 4, project_manager: 1 }, { meta: ['agile_at_scale'] }).total).toBe(16 + 1 + 4);
    expect(score({ junior_dev: 2 }, { meta: ['agile_at_scale'] }).total).toBe(3);
  });
});

describe('meta cards', () => {
  it('Developer Shortage adds 1 per Junior', () => {
    expect(score({ junior_dev: 3 }, { meta: ['developer_shortage'] }).total).toBe(7 + 3);
  });

  it('Zero Defect Premium: +4 clean, -5 per Bug otherwise', () => {
    expect(score({ junior_dev: 1 }, { meta: ['zero_defect_premium'] }).total).toBe(1 + 4);
    expect(score({ bug: 1 }, { meta: ['zero_defect_premium'] }).total).toBe(-5);
  });

  it('Venture Capital Boom: +2 per Investors, +3 more each without Coffee', () => {
    const full = { junior_dev: 1, project_manager: 1, designer: 1, qa_tester: 1, investors: 1 };
    expect(score(full, { meta: ['venture_capital_boom'] }).total).toBe(2 + 1 + 2 + 3 + 5 + 5);
    expect(score({ ...full, coffee: 1 }, { meta: ['venture_capital_boom'] }).total).toBe(2 + 1 + 2 + 3 + 5 + 1 + 2);
  });

  it('graded Meta cards give a base per card and more when the condition holds [P40]', () => {
    expect(score({ designer: 2 }, { meta: ['design_thinking_boom'] }).total).toBe(5 + 2 * 2);
    expect(score({ designer: 2, project_manager: 1 }, { meta: ['design_thinking_boom'] }).total).toBe(5 + 1 + 2);
    expect(score({ junior_dev: 1, designer: 1 }, { meta: ['self_organizing_teams'] }).total).toBe(1 + 2 + 2);
    expect(score({ junior_dev: 1, designer: 1, investors: 1 }, { meta: ['self_organizing_teams'] }).total).toBe(1 + 2 + 2 + 2);
    expect(score({ designer: 3, bug: 1 }, { meta: ['user_experience_premium'] }).total).toBe(12 - 4 + 3 + 4);
  });

  it('Startup Accelerator: +4 for 3-4 employees, +1 for 5 or more', () => {
    expect([2, 3, 5].map((k) => score({ designer: k }, { meta: ['startup_accelerator'] }).total - score({ designer: k }).total)).toEqual([0, 4, 1]);
  });

  it('Small Team Advantage counts unused slots against the turn count', () => {
    expect(score({ designer: 1 }, { meta: ['small_team_advantage'], turns: 8 }).total).toBe(2 + 7);
  });

  it('Tech Giant Poaching: +4 for strictly the most employees, +2 when tied or second', () => {
    expect(score({ junior_dev: 2 }, { meta: ['tech_giant_poaching'], others: [{ junior_dev: 1 }] }).total).toBe(3 + 4);
    expect(score({ junior_dev: 2 }, { meta: ['tech_giant_poaching'], others: [{ junior_dev: 2 }] }).total).toBe(3 + 2);
    expect(score({ junior_dev: 1 }, { meta: ['tech_giant_poaching'], others: [{ junior_dev: 2 }, { junior_dev: 3 }] }).total).toBe(1);
  });
});
