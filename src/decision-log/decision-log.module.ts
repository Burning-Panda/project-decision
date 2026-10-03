import { DynamicModule, Module } from '@nestjs/common';
import { DecisionLog } from './decision-log';
import { DECISION_LOG_OPTIONS, LogContext } from './core/log-context';
import { AccessService } from './core/access.service';
import { AuditService } from './core/audit.service';
import { OwnersService } from './owners/owners.service';
import { TeamsService } from './teams/teams.service';
import { ProjectsService } from './projects/projects.service';
import { DecisionsService } from './decisions/decisions.service';
import { CommentsService } from './comments/comments.service';
import { FollowupsService } from './followups/followups.service';
import { RelatedService } from './related/related.service';
import { ProfilesService } from './profiles/profiles.service';
import { WebhooksService } from './webhooks/webhooks.service';
import { InsightsService } from './insights/insights.service';

export { DECISION_LOG_OPTIONS };

const SERVICES = [
  LogContext, AccessService, AuditService,
  OwnersService, TeamsService, ProjectsService, DecisionsService, CommentsService,
  FollowupsService, RelatedService, ProfilesService, WebhooksService, InsightsService,
];

@Module({})
export class DecisionLogModule {
  static register(options: Record<string, any> = {}): DynamicModule {
    return {
      module: DecisionLogModule,
      providers: [{ provide: DECISION_LOG_OPTIONS, useValue: options }, ...SERVICES, DecisionLog],
      exports: [DecisionLog, ...SERVICES],
    };
  }
}
