import type { OrganizerRoles } from "../../domain/shared/organizer-permissions";

export interface EventRecord {
  id: string;
  organization_id: string;
  organization_name: string;
  organization_slug: string;
  name: string;
  slug: string;
  description: string | null;
  status: "draft" | "open" | "closed";
  intents: string[];
  zones: string[];
  form_config: Record<string, unknown>;
  created_at: Date;
}

export interface RosterAttendeeInput {
  name: string | null;
  email: string;
  phone: string | null;
  about_me: string | null;
  designation: string | null;
  domain: string | null;
  self_description: string | null;
  years_of_experience: number | null;
  most_impressive_build: string | null;
}

export interface RosterImportResult {
  created: number;
  attached: number;
  alreadyOnRoster: number;
  keptExisting: number;
  phoneConflicts: number;
}

export interface EventRepository {
  findBySlug(organizationSlug: string, eventSlug: string): Promise<EventRecord | null>;
  findByEventSlug(eventSlug: string): Promise<EventRecord | null>;
  findOrganization(slug: string): Promise<{ id: string; name: string; slug: string } | null>;
  /** With viewerId, only the events that person may open. */
  listForOrganization(organizationSlug: string, viewerId?: string): Promise<EventRecord[]>;
  organizerRoles(eventId: string, attendeeId: string): Promise<OrganizerRoles>;
  hasOrganizationAccess(organizationSlug: string, attendeeId: string): Promise<boolean>;
  isOrganizer(eventId: string, attendeeId: string): Promise<boolean>;
  create(input: { organizationId: string; organizerId: string; name: string; slug: string; description?: string | null }): Promise<EventRecord>;
  update(input: { eventId: string; organizerId: string; name?: string; description?: string | null; status?: EventRecord["status"]; intents?: string[]; zones?: string[]; formConfig?: Record<string, unknown> }): Promise<EventRecord | null>;
  roster(eventId: string): Promise<Array<Record<string, unknown>>>;
  attachRoster(eventId: string, attendeeIds: string[]): Promise<number>;
  participantIds(eventId: string): Promise<string[]>;
  importRoster(eventId: string, records: RosterAttendeeInput[]): Promise<RosterImportResult>;
  analytics(eventId: string): Promise<{
    roster: number; invited: number; claimed: number; profiles: number; removed: number;
    matches: number; pendingIntros: number; acceptedIntros: number;
  }>;
  invitationTargets(eventId: string, attendeeId: string | null, resendAfterMinutes: number): Promise<Array<{ attendee_id: string; email: string; name: string | null }>>;
  recordInvitation(eventId: string, attendeeId: string, error: string | null): Promise<void>;
  markClaimed(eventId: string, attendeeId: string): Promise<void>;
  setRevoked(eventId: string, attendeeId: string, revoked: boolean): Promise<boolean>;
  rosterState(eventId: string, attendeeId: string): Promise<"active" | "revoked" | null>;
}
