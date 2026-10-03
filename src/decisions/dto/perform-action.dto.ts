import { AddMeetingPayloadDto } from './actions/add-meeting-payload.dto';
import { ApprovePayloadDto } from './actions/approve-payload.dto';
import { AssignFollowupPayloadDto } from './actions/assign-followup-payload.dto';
import { CreateSupersedingDecisionPayloadDto } from './actions/create-superseding-decision-payload.dto';
import { DeclinePayloadDto } from './actions/decline-payload.dto';
import { ProposePayloadDto } from './actions/propose-payload.dto';
import { RequestRevisionPayloadDto } from './actions/request-revision-payload.dto';
import { VotePayloadDto } from './actions/vote-payload.dto';

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
