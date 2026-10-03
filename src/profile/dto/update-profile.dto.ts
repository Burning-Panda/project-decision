import type { PushSubscription } from '../../notifications/push';
import { NotificationPreferencesDto } from './notification-preferences.dto';

export class UpdateProfileDto {
  email?: string;
  phone?: string | null;
  /** `PushSubscription.toJSON()` from each browser the user enabled notifications in; at most ten. */
  push_subscriptions?: PushSubscription[];
  preferences?: NotificationPreferencesDto;
}
