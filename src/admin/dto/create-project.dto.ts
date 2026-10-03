import { ProjectSettingsDto } from './project-settings.dto';

export class CreateProjectDto {
  owner: string;
  team?: string;
  identifier: string;
  title: string;
  description?: string;
  settings?: ProjectSettingsDto;
}
