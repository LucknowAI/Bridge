import type { EventId, OrganizationId, ParticipantId } from "./value-objects";

/** Tenant identity is explicit at every use-case boundary. */
export interface TenantContext {
  organizationId: OrganizationId;
  eventId: EventId;
  actorId: ParticipantId;
  actorRole: "participant" | "organizer" | "admin";
}

export function assertTenant(context: TenantContext): TenantContext {
  if (!context.organizationId || !context.eventId || !context.actorId) {
    throw new Error("A complete tenant context is required");
  }
  return context;
}
