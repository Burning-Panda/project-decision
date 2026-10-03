import { todo } from '../../helpers/errors/todo.js';
import type { CreateProjectDto } from '../../admin/dto/create-project.dto.js';
import type { ApprovalSettingsDto } from '../../admin/dto/approval-settings.dto.js';

export interface ProjectRecord {
  owner: string;
  team: string;
  identifier: string;
  title: string;
  description: string;
  active: boolean;
  decision_count: number;
  last_number: number;
  approval_settings: Required<Omit<ApprovalSettingsDto, 'vote_weights'>> & { vote_weights: Record<string, number> };
  created_at: string;
  updated_at: string;
}

/**
 * Pure domain object: invariants only, no store, clock or audit.
 * ProjectsService does authorization, uniqueness and persistence around it.
 */
export class Project {
  /** Validates the input (identifier, title, settings) and returns a fresh record stamped with `now`. */
  static create(_input: Omit<CreateProjectDto, 'settings'> & { settings?: CreateProjectDto['settings'] }, _now: string): ProjectRecord {
    return todo('Project.create');
  }

  /** Merges `patch` over `current` approval settings and re-validates; returns the new settings. */
  static resolveSettings(_patch: ApprovalSettingsDto | undefined, _current?: ProjectRecord['approval_settings']): ProjectRecord['approval_settings'] {
    return todo('Project.resolveSettings');
  }
}
