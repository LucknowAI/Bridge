export interface NotificationPort {
  introRequested(input: { recipientEmail: string; recipientName: string; requesterName: string; eventName: string; introId: string }): Promise<void>;
  introResponded(input: { recipientEmail: string; recipientName: string; requesterName: string; eventName: string; accepted: boolean }): Promise<void>;
}
