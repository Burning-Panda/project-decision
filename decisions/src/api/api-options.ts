export const API_OPTIONS = Symbol('API_OPTIONS');

export interface ApiOptions {
  log: unknown;
  /** Awaited after every successful non-GET request, before the response is sent (durable-before-ack). */
  onMutation?: () => unknown | Promise<unknown>;
}
