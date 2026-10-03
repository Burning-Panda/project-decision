import { NotImplementedError } from '../common/errors';

export class NotificationChannel {
  constructor() {
    throw new NotImplementedError('NotificationChannel');
  }
}
export class NotificationManager {
  constructor(_log: unknown, _options: Record<string, any> = {}) {
    throw new NotImplementedError('NotificationManager');
  }
}
export const createNotificationPayload = (_input: Record<string, any>): any => throw new NotImplementedError('createNotificationPayload');
export const validateNotificationPayload = (_input: unknown): string[] => throw new NotImplementedError('validateNotificationPayload');
export const sent = (_providerId: string): any => throw new NotImplementedError('sent');
export const failed = (_error: string, _options?: { retryable?: boolean }): any => throw new NotImplementedError('failed');
export const skipped = (_reason: string): any => throw new NotImplementedError('skipped');
export const isDeliveryResult = (_value: unknown): boolean => throw new NotImplementedError('isDeliveryResult');
export const checkChannelConformance = async (_channel: unknown, _fixtures: Record<string, any>): Promise<string[]> => throw new NotImplementedError('checkChannelConformance');
