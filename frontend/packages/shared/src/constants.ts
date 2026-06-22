/**
 * Shared marketplace constants — dependency-free.
 *
 * The Op order MUST stay identical to the guest / contract (cdm-shared::agg):
 * WEIGHTED_SUM=0, SUM=1, AVG=2, COUNT=3, MIN=4, MAX=5.
 */

/**
 * Job operation codes (corresponds to the guest Op enum).
 */
export const OpCodes = {
  WEIGHTED_SUM: 0,
  SUM: 1,
  AVG: 2,
  COUNT: 3,
  MIN: 4,
  MAX: 5,
} as const;

/**
 * Job operation names, indexed by op code (corresponds to the guest Op enum).
 */
export const OpNames = [
  "WEIGHTED_SUM",
  "SUM",
  "AVG",
  "COUNT",
  "MIN",
  "MAX",
] as const;

export type OpName = (typeof OpNames)[number];

/**
 * AVG is reported as a ×100 fixed-point integer by the guest (floor(sum*100/count)).
 */
export const AVG_FIXED_POINT_SCALE = 100;

/**
 * k-anonymity privacy presets shown in the register form.
 */
export const KAnonymityLevels = {
  NONE: 0,
  MINIMAL: 3,
  STANDARD: 5,
  HIGH: 10,
  MAXIMUM: 50,
} as const;
