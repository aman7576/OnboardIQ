// R4: age below the minimum age (completed years on application_date) -> REJECT
import type { Rule } from './rule.js';

export const r4: Rule = {
  id: 'R4',
  code: 'AGE_BELOW_18',
  outcome: 'REJECT',
  needs: ['dob', 'application_date'],
  test: ({ app, ageYears, config }) => ({
    triggered: ageYears < config.min_age,
    compared: {
      dob: app.dob,
      applicationDate: app.applicationDate,
      ageYears,
      minAge: config.min_age,
    },
  }),
};
