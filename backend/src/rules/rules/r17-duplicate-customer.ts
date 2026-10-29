// R17: declared pan_number exists in existing_customers -> REVIEW
import type { Rule } from './rule.js';

export const r17: Rule = {
  id: 'R17',
  code: 'DUPLICATE_CUSTOMER',
  outcome: 'REVIEW',
  needs: ['declared pan_number', 'existing customers'],
  test: ({ app, existingPans }) => ({
    triggered: existingPans.has(app.panNumber),
    compared: { pan: app.panNumber },
  }),
};
