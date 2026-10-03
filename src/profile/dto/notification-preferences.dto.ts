export class NotificationPreferencesDto {
  channels?: { email?: boolean; sms?: boolean; push?: boolean };
  muted_types?: string[];
}
