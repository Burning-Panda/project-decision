const pending: Array<() => unknown> = [];

/** Registers teardown work that runs after the current test (LIFO), whatever the outcome. */
export const onCleanup = (fn: () => unknown) => {
  pending.push(fn);
};

export async function runCleanups() {
  while (pending.length) {
    try {
      await pending.pop()!();
    } catch {
      /* teardown must never mask the test result */
    }
  }
}
