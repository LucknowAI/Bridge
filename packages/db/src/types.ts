/** Row shape of `registered_attendees`. Mirrors migration 0001. */
export interface Attendee {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  about_me: string | null;
  designation: string | null;
  domain: string | null;
  self_description: string | null;
  years_of_experience: number | null;
  most_impressive_build: string | null;
  created_at: Date;
  updated_at: Date;
}

/** Row shape of `login_challenges`. Mirrors migration 0002. */
export interface LoginChallenge {
  id: string;
  email: string;
  attendee_id: string | null;
  code_hash: string;
  token_hash: string;
  expires_at: Date;
  consumed_at: Date | null;
  attempts: number;
  ip_address: string | null;
  created_at: Date;
}

/** Row shape of `match_sessions`. Mirrors migration 0001. */
export interface MatchSession {
  id: string;
  user_subject: string;
  matched_with: string | null;
  score: number | null;
  match_reason: string | null;
  created_at: Date;
}

/** The attendee fields safe to send to the browser for a *match candidate*. */
export type PublicAttendee = Pick<
  Attendee,
  | "id"
  | "name"
  | "designation"
  | "domain"
  | "about_me"
  | "self_description"
  | "years_of_experience"
  | "most_impressive_build"
>;
