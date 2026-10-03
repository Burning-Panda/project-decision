export type TeamRole = 'member' | 'lead' | 'admin';

export interface TeamMember {
  user: string;
  role: TeamRole;
}

export interface Team {
  owner: string;
  name: string;
  members: TeamMember[];
  created_at: string;
  updated_at: string;
}
