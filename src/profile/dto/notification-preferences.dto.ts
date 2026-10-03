export class NotificationPreferencesDto {
  channels?: { email?: boolean; sms?: boolean; push?: boolean };
  order?: Array<'email' | 'sms' | 'push'>;
  mode?: 'all' | 'fallback';
  muted_types?: string[];
}
