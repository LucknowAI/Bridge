export enum Intent {
  NETWORKING = "NETWORKING",
  SEEKING_MENTOR = "SEEKING_MENTOR",
  MENTORING = "MENTORING",
  LOOKING_FOR_COFOUNDER = "LOOKING_FOR_COFOUNDER",
  LOOKING_FOR_COLLABORATORS = "LOOKING_FOR_COLLABORATORS",
  LOOKING_FOR_WORK = "LOOKING_FOR_WORK",
  HIRING = "HIRING",
  RAISING_FUNDING = "RAISING_FUNDING",
  INVESTING = "INVESTING",
}

/** Directional compatibility: the row contains intents a person welcomes. */
export const INTENT_COMPATIBILITY: Record<Intent, Intent[]> = {
  [Intent.NETWORKING]: Object.values(Intent),
  [Intent.SEEKING_MENTOR]: [Intent.MENTORING, Intent.NETWORKING],
  [Intent.MENTORING]: [Intent.SEEKING_MENTOR, Intent.NETWORKING],
  [Intent.LOOKING_FOR_COFOUNDER]: [Intent.LOOKING_FOR_COFOUNDER, Intent.NETWORKING],
  [Intent.LOOKING_FOR_COLLABORATORS]: [Intent.LOOKING_FOR_COLLABORATORS, Intent.NETWORKING],
  [Intent.LOOKING_FOR_WORK]: [Intent.HIRING, Intent.NETWORKING],
  [Intent.HIRING]: [Intent.LOOKING_FOR_WORK, Intent.NETWORKING],
  [Intent.RAISING_FUNDING]: [Intent.INVESTING, Intent.NETWORKING],
  [Intent.INVESTING]: [Intent.RAISING_FUNDING, Intent.NETWORKING],
};

/**
 * The intents a person welcomes, for narrowing retrieval before any top-K
 * cut; null when they welcome everyone.
 */
export function welcomedIntents(intent: Intent): Intent[] | null {
  const welcomed = INTENT_COMPATIBILITY[intent] ?? [];
  return welcomed.length === Object.values(Intent).length ? null : [...welcomed].sort();
}

export function isIntentCompatible(from: Intent, to: Intent): boolean {
  return INTENT_COMPATIBILITY[from]?.includes(to) ?? false;
}

export function areIntentsMutuallyCompatible(a: Intent, b: Intent): boolean {
  return isIntentCompatible(a, b) && isIntentCompatible(b, a);
}
