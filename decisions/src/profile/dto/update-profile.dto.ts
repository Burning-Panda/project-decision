import { NotificationPreferencesDto } from './notification-preferences.dto.js';

export class UpdateProfileDto {
  email?: string;
  phone?: string | null;
  push_tokens?: string[];
  preferences?: NotificationPreferencesDto;
}
