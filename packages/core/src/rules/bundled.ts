// The repository's rule files, bundled at build time (no runtime I/O).
// Import attributes keep this module loadable by Vite, Node and Deno alike.
import drugClasses from '../../../../rules/drug_classes.json' with { type: 'json' };
import medicationRisks from '../../../../rules/medication_risks.json' with { type: 'json' };
import interactions from '../../../../rules/interactions.json' with { type: 'json' };
import sideEffects from '../../../../rules/side_effect_associations.json' with { type: 'json' };
import { loadRules, type RawRuleFiles, type RuleSet } from './loader.ts';

export const RAW_RULE_FILES: RawRuleFiles = {
  drugClasses,
  medicationRisks,
  interactions,
  sideEffects,
};

let cached: RuleSet | null = null;

/** Validated rules from /rules (validated once, then cached). */
export function getBundledRules(): RuleSet {
  cached ??= loadRules(RAW_RULE_FILES);
  return cached;
}
