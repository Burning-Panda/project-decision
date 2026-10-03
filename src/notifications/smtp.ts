import { todo } from '../helpers/errors/todo';

export class SmtpError extends Error {
  code: number | null = null;
  retryable = true;
}

export class SmtpTransport {
  constructor(_options: Record<string, any>) {
    todo('SmtpTransport');
  }
  send(_message: Record<string, any>): Promise<any> {
    return todo('SmtpTransport.send');
  }
}

export const parseSmtpUrl = (_url: string): Record<string, any> => todo('parseSmtpUrl');
