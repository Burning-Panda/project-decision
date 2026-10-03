/** When a failed delivery is tried again; `null` means give up. Injectable so the dispatcher stays free of timing rules. */
export interface RetryPolicy {
  nextAttemptAt(attempt: number, failedAt: Date): Date | null;
}
