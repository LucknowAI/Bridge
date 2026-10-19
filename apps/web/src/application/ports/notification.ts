/** One delivered message: who it goes to and the page it links to. */
export interface NotificationTarget {
  recipientEmail: string;
  recipientName: string;
  otherName: string;
  eventName: string;
  /** Deep link to the interaction, e.g. the connection on the Connections page. */
  link: string;
}

export interface NotificationPort {
  invitation(input: { email: string; name: string | null; eventName: string; organizationName: string; eventUrl: string }): Promise<void>;
  introRequested(input: NotificationTarget): Promise<void>;
  introAccepted(input: NotificationTarget): Promise<void>;
  locationRequested(input: NotificationTarget): Promise<void>;
  locationAnswered(input: NotificationTarget & { zone: string | null }): Promise<void>;
}
