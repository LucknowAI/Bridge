export type IntroStatus = "pending" | "accepted" | "declined";

export interface IntroRequest {
  id: string;
  eventId: string;
  requesterId: string;
  recipientId: string;
  status: IntroStatus;
  message: string | null;
  createdAt: Date;
  respondedAt: Date | null;
}

export function createIntroRequest(input: {
  id: string;
  eventId: string;
  requesterId: string;
  recipientId: string;
  message?: string | null;
}): IntroRequest {
  if (input.requesterId === input.recipientId) throw new Error("You cannot request an intro to yourself");
  return {
    id: input.id,
    eventId: input.eventId,
    requesterId: input.requesterId,
    recipientId: input.recipientId,
    status: "pending",
    message: input.message?.trim().slice(0, 500) || null,
    createdAt: new Date(),
    respondedAt: null,
  };
}

export function respondToIntro(request: IntroRequest, accept: boolean, actorId: string): IntroRequest {
  if (request.recipientId !== actorId) throw new Error("Only the recipient can respond to an intro request");
  if (request.status !== "pending") throw new Error("This intro request has already been answered");
  return { ...request, status: accept ? "accepted" : "declined", respondedAt: new Date() };
}
