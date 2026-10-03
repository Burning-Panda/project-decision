export interface Migration { version: number; name: string; up: (schema: string) => string }

export const MIGRATIONS: Migration[] = [];
