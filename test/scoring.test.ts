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
  it('Junior tiers 1/3/7 cap at 3+', () => {
    expect(score({ junior_dev: 1 }).total).toBe(1);
    expect(score({ junior_dev: 2 }).total).toBe(3);
    expect(score({ junior_dev: 5 }).total).toBe(7);
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
  it('Investors need all 4 role groups', () => {
    expect(score({ investors: 1, junior_dev: 1, designer: 1, qa_tester: 1 }).total).toBe(1 + 2 + 3);
    expect(score({ investors: 1, senior_dev: 1, project_manager: 1, designer: 1, qa_tester: 1 }).total).toBe(1 + 0 + 2 + 3 + 5);
  });

  it('Scope Creep zeroes Coffee and Investors', () => {
    const spec = { coffee: 2, investors: 1, junior_dev: 1, project_manager: 1, designer: 1, qa_tester: 1 };
    expect(score(spec).total).toBe(2 + 5 + 2 + 2 + 3);
    expect(score(spec, { crisis: ['scope_creep'] }).total).toBe(2 + 2 + 3);
  });
});

describe('crisis penalties', () => {
  it('Technical Debt takes 1 per Senior', () => {
    expect(score({ senior_dev: 1, junior_dev: 1 }, { crisis: ['technical_debt'] }).total).toBe(3 + 1 - 1);
  });

  it('Merge Conflict zeroes 2+ Seniors', () => {
    expect(score({ senior_dev: 2, junior_dev: 1 }, { crisis: ['merge_conflict'] }).total).toBe(1);
    expect(score({ senior_dev: 1, junior_dev: 1 }, { crisis: ['merge_conflict'] }).total).toBe(4);
  });

  it('Tech Debt Payoff cancels the most costly penalty', () => {
    const r = score({ senior_dev: 3, junior_dev: 1, tech_debt_payoff: 1 }, { crisis: ['merge_conflict', 'technical_debt'] });
    // Cancelling Merge Conflict leaves 9 + 1 - 3 = 7; cancelling Technical Debt leaves 0 + 1 = 1.
    expect(r.total).toBe(7);
  });
});

describe('crisis bonuses', () => {
  it('Unicorn Hype needs 4 roles and no unpaired Bug', () => {
    const full = { junior_dev: 1, project_manager: 1, designer: 1, qa_tester: 1 };
    expect(score(full, { crisis: ['unicorn_hype'] }).total).toBe(2 + 2 + 3 + 15);
    expect(score({ ...full, bug: 1 }, { crisis: ['unicorn_hype'] }).total).toBe(2 + 2 + 15); // QA pairs with the Bug
    expect(score({ ...full, bug: 2 }, { crisis: ['unicorn_hype'] }).total).toBe(2 + 2 - 3);
  });

  it('Unicorn Rush makes Unicorn Hype +20 with 3 roles and Coffee -2', () => {
    expect(score({ junior_dev: 1, designer: 1, qa_tester: 1, coffee: 1 }, { crisis: ['unicorn_hype'], meta: ['unicorn_rush'] }).total).toBe(1 + 2 + 3 + 1 + 20 - 2);
  });

  it('Viral Success: most Designers +2, others +1', () => {
    expect(score({ designer: 2 }, { crisis: ['viral_success'], others: [{ designer: 1 }] }).total).toBe(5 + 2);
    expect(score({ designer: 1 }, { crisis: ['viral_success'], others: [{ designer: 2 }] }).total).toBe(2 + 1);
  });
});

describe('printed card text matches scoring', () => {
  it('Junior with one PM scores the printed PM row 2/6/14', () => {
    expect([1, 2, 3, 5].map((j) => score({ junior_dev: j, project_manager: 1 }).total)).toEqual([2, 6, 14, 14]);
  });

  it('Agile at Scale sets Junior to 17 with a PM and 4+ Juniors', () => {
    expect(score({ junior_dev: 5, project_manager: 1 }, { meta: ['agile_at_scale'] }).total).toBe(17);
  });
});

describe('meta cards', () => {
  it('Developer Shortage adds 2 per Junior', () => {
    expect(score({ junior_dev: 3 }, { meta: ['developer_shortage'] }).total).toBe(7 + 6);
  });

  it('Agile at Scale x2.5 rounds down', () => {
    expect(score({ junior_dev: 4, project_manager: 1 }, { meta: ['agile_at_scale'] }).total).toBe(17);
    expect(score({ junior_dev: 3, project_manager: 1 }, { meta: ['agile_at_scale'] }).total).toBe(14);
  });

  it('Zero Defect Premium: +8 clean, -5 per Bug otherwise', () => {
    expect(score({ junior_dev: 1 }, { meta: ['zero_defect_premium'] }).total).toBe(1 + 8);
    expect(score({ bug: 1 }, { meta: ['zero_defect_premium'] }).total).toBe(-5);
  });

  it('Venture Capital Boom: Investors +8 without Coffee', () => {
    const full = { junior_dev: 1, project_manager: 1, designer: 1, qa_tester: 1, investors: 1 };
    expect(score(full, { meta: ['venture_capital_boom'] }).total).toBe(2 + 2 + 3 + 8);
    expect(score({ ...full, coffee: 1 }, { meta: ['venture_capital_boom'] }).total).toBe(2 + 2 + 3 + 5 + 1);
  });

  it('Small Team Advantage counts unused slots against the turn count', () => {
    expect(score({ designer: 1 }, { meta: ['small_team_advantage'], turns: 8 }).total).toBe(2 + 7);
  });

  it('Tech Giant Poaching needs strictly the most employees', () => {
    expect(score({ junior_dev: 2 }, { meta: ['tech_giant_poaching'], others: [{ junior_dev: 1 }] }).total).toBe(3 + 6);
    expect(score({ junior_dev: 2 }, { meta: ['tech_giant_poaching'], others: [{ junior_dev: 2 }] }).total).toBe(3);
  });
});
