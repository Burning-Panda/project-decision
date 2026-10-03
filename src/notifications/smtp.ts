import { NotImplementedError } from '../common/errors';

export class SmtpError extends Error {
  code: number | null = null;
  retryable = true;
}

export class SmtpTransport {
  constructor(_options: Record<string, any>) {
    throw new NotImplementedError('SmtpTransport');
  }
  send(_message: Record<string, any>): Promise<any> {
    throw new NotImplementedError('SmtpTransport.send');
  }
}

export const parseSmtpUrl = (_url: string): Record<string, any> => {
  throw new NotImplementedError('parseSmtpUrl');
};
