import { NotImplementedError } from '../../common/errors';

/** Marks a not-yet-built piece; the red spec that needs it will fail here. */
export const todo = (what: string): never => {
  throw new NotImplementedError(`TODO: ${what}`);
};
