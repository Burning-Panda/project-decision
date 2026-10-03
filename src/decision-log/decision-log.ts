import { Inject, Injectable } from '@nestjs/common';
import type { CreateOwnerDto } from '../admin/dto/create-owner.dto';
import type { CreateTeamDto } from '../admin/dto/create-team.dto';
import type { AddTeamMemberDto } from '../admin/dto/add-team-member.dto';
import type { CreateProjectDto } from '../admin/dto/create-project.dto';
import type { ProjectSettingsDto } from '../admin/dto/project-settings.dto';
import type { CreateDecisionDto } from '../decisions/dto/create-decision.dto';
import type { PerformActionDto } from '../decisions/dto/perform-action.dto';
import type { CreateWebhookDto } from '../webhooks/dto/create-webhook.dto';
import { LogContext } from './core/log-context';
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

/**
 * Public facade the specs and the HTTP API talk to. It holds no logic: each method delegates to the
 * service that owns the aggregate. Add behaviour in the service, not here.
 */
@Injectable()
export class DecisionLog {
  constructor(
    @Inject(LogContext) private readonly ctx: LogContext,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OwnersService) private readonly owners: OwnersService,
    @Inject(TeamsService) private readonly teams: TeamsService,
    @Inject(ProjectsService) private readonly projects: ProjectsService,
    @Inject(DecisionsService) private readonly decisions: DecisionsService,
    @Inject(CommentsService) private readonly comments: CommentsService,
    @Inject(FollowupsService) private readonly followups: FollowupsService,
    @Inject(RelatedService) private readonly related: RelatedService,
    @Inject(ProfilesService) private readonly profiles: ProfilesService,
    @Inject(WebhooksService) private readonly webhooks: WebhooksService,
    @Inject(InsightsService) private readonly insights: InsightsService,
  ) {}

  get options() { return this.ctx.options; }
  get store() { return this.ctx.store; }
  get clock() { return this.ctx.options.clock ?? (() => new Date()); }
  /** Lets webhooks target private and loopback addresses (local development only). Kept in the shared options. */
  get allowPrivateTargets(): boolean { return Boolean(this.ctx.options.allowPrivateTargets); }
  set allowPrivateTargets(allow: boolean) { this.ctx.options.allowPrivateTargets = allow; }

  // owners, teams, projects
  createOwner(input: CreateOwnerDto) { return this.owners.create(input); }
  createTeam(input: CreateTeamDto & { actor: string }) { return this.teams.create(input); }
  addTeamMember(input: AddTeamMemberDto & { actor: string }) { return this.teams.addMember(input); }
  getTeam(owner: string, name?: string) { return this.teams.get(owner, name); }
  createProject(input: CreateProjectDto & { actor: string }) { return this.projects.create(input); }
  getProject(identifier: string) { return this.projects.get(identifier); }
  updateProjectSettings(identifier: string, actor: string, settings: ProjectSettingsDto) { return this.projects.updateSettings(identifier, actor, settings); }

  // decisions
  createDecision(input: CreateDecisionDto & { actor: string }) { return this.decisions.create(input); }
  updateDraft(id: string, actor: string, patch: { title?: string; content?: string } = {}) { return this.decisions.updateDraft(id, actor, patch); }
  deleteDraft(id: string, actor: string) { return this.decisions.deleteDraft(id, actor); }
  getDecision(id: string, actor: string) { return this.decisions.get(id, actor); }
  listDecisions(filters: Record<string, any> = {}) { return this.decisions.list(filters); }
  perform(id: string, actor: string, request: PerformActionDto, opts: Record<string, any> = {}) { return this.decisions.perform(id, actor, request, opts); }
  sweep() { return this.decisions.sweep(); }
  getVersions(id: string, actor: string) { return this.decisions.versions(id, actor); }
  diff(id: string, actor: string, range: Record<string, any> = {}) { return this.decisions.diff(id, actor, range as any); }
  verifyIntegrity(id: string) { return this.decisions.verifyIntegrity(id); }
  getParticipants(id: string, actor: string) { return this.decisions.participants(id, actor); }
  renderDecisionDocument(id: string, actor: string) { return this.decisions.renderDocument(id, actor); }

  // comments
  addComment(id: string, actor: string, input: Record<string, any> = {}) { return this.comments.add(id, actor, input as any); }
  listComments(id: string, actor: string) { return this.comments.list(id, actor); }
  editComment(id: string, commentId: string, actor: string, content: string) { return this.comments.edit(id, commentId, actor, content); }
  deleteComment(id: string, commentId: string, actor: string) { return this.comments.remove(id, commentId, actor); }
  resolveComment(id: string, commentId: string, actor: string, resolved = true) { return this.comments.resolve(id, commentId, actor, resolved); }

  // follow-ups, todos, meetings
  addFollowup(id: string, actor: string, input: Record<string, any> = {}) { return this.followups.addFollowup(id, actor, input as any); }
  listTodos(filters: Record<string, any> = {}) { return this.followups.listTodos(filters as any); }
  updateTodo(todoId: string, actor: string, patch: Record<string, any> = {}) { return this.followups.updateTodo(todoId, actor, patch as any); }
  todoStats(user: string) { return this.followups.todoStats(user); }
  addMeeting(id: string, actor: string, input: Record<string, any> = {}) { return this.followups.addMeeting(id, actor, input as any); }
  renderMeetingNotes(id: string, actor: string) { return this.followups.renderMeetingNotes(id, actor); }

  // related decisions
  getRelated(id: string, actor: string, opts: Record<string, any> = {}) { return this.related.get(id, actor, opts); }
  addRelated(id: string, actor: string, link: { related_decision_id: string; type: string }) { return this.related.add(id, actor, link); }
  reviewRelated(id: string, relatedId: string, actor: string, verdict: string) { return this.related.review(id, relatedId, actor, verdict); }

  // profiles and notifications
  getProfile(user: string, actor: string) { return this.profiles.get(user, actor); }
  setProfile(user: string, actor: string, input: Record<string, any> = {}) { return this.profiles.set(user, actor, input as any); }
  listNotifications(user: string) { return this.profiles.listNotifications(user); }

  // webhooks
  createWebhook(input: CreateWebhookDto & { actor: string }) { return this.webhooks.create(input); }
  listWebhooks(owner: string, actor: string) { return this.webhooks.list(owner, actor); }
  deleteWebhook(id: string, actor: string) { return this.webhooks.remove(id, actor); }
  listDeliveries(webhookId: string, actor: string, query: Record<string, any> = {}) { return this.webhooks.deliveries(webhookId, actor, query as any); }
  redeliver(deliveryId: string, actor: string) { return this.webhooks.redeliver(deliveryId, actor); }
  webhookSecret(hook: { id: string; secret_enc: string }) { return this.webhooks.secret(hook); }
  pruneOutbox(opts: { olderThanDays?: number } = {}) { return this.webhooks.pruneOutbox(opts); }
  pruneChannelDeliveries(opts: { olderThanDays?: number } = {}) { return this.webhooks.pruneChannelDeliveries(opts); }
  rotateSecrets() { return this.webhooks.rotateSecrets(); }

  // insights and audit
  search(args: Record<string, any>) { return this.insights.search(args as any); }
  dashboard(user: string) { return this.insights.dashboard(user); }
  report(type: string, args: Record<string, any> = {}) { return this.insights.report(type, args as any); }
  exportDecisions(args: Record<string, any>) { return this.insights.exportDecisions(args as any); }
  auditTrail(filters: Record<string, any> = {}) { return this.audit.trail(filters); }
  verifyAuditChain() { return this.audit.verifyChain(); }
}
