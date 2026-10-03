export class VotePayloadDto {
  vote: 'approve' | 'request_revision' | 'abstain';
  comment?: string;
}
