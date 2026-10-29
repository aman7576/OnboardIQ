// Risk category and re-KYC date (spec 6.1.2). Both come from configuration and the occupation table.
import { addYears } from './dates.js';
import type { ApplicationInput, EngineConfig, ReasonCode, RiskLevel } from './types.js';

/**
 * HIGH if PEP_MATCH or SANCTIONS_POSSIBLE_MATCH triggered or the occupation risk is HIGH;
 * otherwise MEDIUM if the occupation risk is MEDIUM or annual income reaches the threshold; else LOW.
 */
export function riskCategory(
  app: ApplicationInput,
  triggered: ReadonlySet<ReasonCode>,
  config: EngineConfig,
): RiskLevel {
  const occupation = config.occupations[app.occupationCode];
  if (occupation === undefined) throw new Error(`unknown occupation_code ${app.occupationCode}`);
  if (
    triggered.has('PEP_MATCH') ||
    triggered.has('SANCTIONS_POSSIBLE_MATCH') ||
    occupation === 'HIGH'
  )
    return 'HIGH';
  if (occupation === 'MEDIUM' || app.annualIncome >= config.medium_risk_income) return 'MEDIUM';
  return 'LOW';
}

export const rekycDueDate = (
  applicationDate: string,
  risk: RiskLevel,
  config: EngineConfig,
): string => addYears(applicationDate, config.rekyc_years[risk]);
