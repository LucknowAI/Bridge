import type { IntroRequest } from "./intro-request.entity";

/** Contact details are disclosed only after both sides accepted. */
export function mayRevealContact(request: IntroRequest): boolean {
  return request.status === "accepted";
}
