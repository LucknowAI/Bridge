export interface NotificationPort {
  invitation(input: { email: string; name: string | null; eventName: string; organizationName: string; eventUrl: string }): Promise<void>;
  introRequested(input: { recipientEmail: string; recipientName: string; requesterName: string; eventName: string; introId: string }): Promise<void>;
  introResponded(input: { recipientEmail: string; recipientName: string; requesterName: string; eventName: string; accepted: boolean }): Promise<void>;
}
