import { drugClassLabel, getBundledRules } from '@medwatch/core';

export const rules = getBundledRules();
export const classLabel = (code: string | null | undefined) => drugClassLabel(rules, code);
