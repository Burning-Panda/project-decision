import { AddMeetingPayloadDto } from './actions/add-meeting-payload.dto.js';
import { ApprovePayloadDto } from './actions/approve-payload.dto.js';
import { AssignFollowupPayloadDto } from './actions/assign-followup-payload.dto.js';
import { CreateSupersedingDecisionPayloadDto } from './actions/create-superseding-decision-payload.dto.js';
import { DeclinePayloadDto } from './actions/decline-payload.dto.js';
import { ProposePayloadDto } from './actions/propose-payload.dto.js';
import { RequestRevisionPayloadDto } from './actions/request-revision-payload.dto.js';
import { VotePayloadDto } from './actions/vote-payload.dto.js';

export type ActionName =
  | 'propose' | 'approve' | 'decline' | 'vote' | 'request_revision' | 'return_to_draft'
  | 'create_superseding_decision' | 'add_comment' | 'assign_followup' | 'add_meeting';

export type ActionPayload =
  | ProposePayloadDto | ApprovePayloadDto | VotePayloadDto | DeclinePayloadDto | RequestRevisionPayloadDto
  | AssignFollowupPayloadDto | AddMeetingPayloadDto | CreateSupersedingDecisionPayloadDto
  | Record<string, never>;

export class PerformActionDto {
  action: ActionName;
  payload?: ActionPayload;
}
