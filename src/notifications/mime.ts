import { NotImplementedError } from '../common/errors';

export const buildMimeMessage = (_message: Record<string, any>): string => {
  throw new NotImplementedError('buildMimeMessage');
};
export const formatAddress = (_address: { name: string | null; address: string }): string => {
  throw new NotImplementedError('formatAddress');
};
export const parseAddress = (_input: string): { name: string | null; address: string } => {
  throw new NotImplementedError('parseAddress');
};
export const dotStuff = (_text: string): string => {
  throw new NotImplementedError('dotStuff');
};
export const encodeWord = (_text: string): string => {
  throw new NotImplementedError('encodeWord');
};
