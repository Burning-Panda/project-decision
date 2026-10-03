export class CreateWebhookDto {
  owner: string;
  url: string;
  events?: string[];
}
