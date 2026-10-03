import { DynamicModule, Module } from '@nestjs/common';
import { DecisionLog } from './decision-log.js';
import { DECISION_LOG_OPTIONS, LogContext } from './core/log-context.js';
import { AccessService } from './core/access.service.js';
import { AuditService } from './core/audit.service.js';
import { OwnersService } from './owners/owners.service.js';
import { TeamsService } from './teams/teams.service.js';
import { ProjectsService } from './projects/projects.service.js';
import { DecisionsService } from './decisions/decisions.service.js';
import { CommentsService } from './comments/comments.service.js';
import { FollowupsService } from './followups/followups.service.js';
import { RelatedService } from './related/related.service.js';
import { ProfilesService } from './profiles/profiles.service.js';
import { WebhooksService } from './webhooks/webhooks.service.js';
import { InsightsService } from './insights/insights.service.js';

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
