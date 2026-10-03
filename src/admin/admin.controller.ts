import { Controller, Body, Get, Param, Post, UseGuards } from '@nestjs/common';
import { XUserGuard } from '../common/x-user.guard';
import { NotImplementedError } from '../common/errors';
import { CreateOwnerDto } from './dto/create-owner.dto';
import { CreateTeamDto } from './dto/create-team.dto';
import { AddTeamMemberDto } from './dto/add-team-member.dto';
import { CreateProjectDto } from './dto/create-project.dto';

@Controller()
@UseGuards(XUserGuard)
export class AdminController {
  @Post('owners')
  createOwner(@Body() body: CreateOwnerDto) {
    throw new NotImplementedError('POST /owners');
  }

  @Post('teams')
  createTeam(@Body() body: CreateTeamDto) {
    throw new NotImplementedError('POST /teams');
  }

  @Post('teams/members')
  addTeamMember(@Body() body: AddTeamMemberDto) {
    throw new NotImplementedError('POST /teams/members');
  }

  @Post('projects')
  createProject(@Body() body: CreateProjectDto) {
    throw new NotImplementedError('POST /projects');
  }

  @Get('projects/:id')
  getProject(@Param('id') id: string) {
    throw new NotImplementedError('GET /projects/:id');
  }
}
