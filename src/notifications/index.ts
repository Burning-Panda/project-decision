import { todo } from '../helpers/errors/todo.js';

export class NotificationChannel {
  constructor() {
    todo('NotificationChannel');
  }
}
export class NotificationManager {
  constructor(_log: unknown, _options: Record<string, any> = {}) {
    todo('NotificationManager');
  }
}
export const createNotificationPayload = (_input: Record<string, any>): any => todo('createNotificationPayload');
export const validateNotificationPayload = (_input: unknown): string[] => todo('validateNotificationPayload');
export const sent = (_providerId: string): any => todo('sent');
export const failed = (_error: string, _options?: { retryable?: boolean }): any => todo('failed');
export const skipped = (_reason: string): any => todo('skipped');
export const isDeliveryResult = (_value: unknown): boolean => todo('isDeliveryResult');
export const checkChannelConformance = async (_channel: unknown, _fixtures: Record<string, any>): Promise<string[]> => todo('checkChannelConformance');
