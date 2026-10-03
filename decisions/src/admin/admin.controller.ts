import { Controller, Body, Get, Param, Post, UseGuards } from '@nestjs/common';
import { XUserGuard } from '../common/x-user.guard.js';
import { todo } from '../helpers/errors/todo.js';
import { CreateOwnerDto } from './dto/create-owner.dto.js';
import { CreateTeamDto } from './dto/create-team.dto.js';
import { AddTeamMemberDto } from './dto/add-team-member.dto.js';
import { CreateProjectDto } from './dto/create-project.dto.js';

@Controller()
@UseGuards(XUserGuard)
export class AdminController {
  @Post('owners')
  createOwner(@Body() body: CreateOwnerDto) {
    return todo('POST /owners');
  }

  @Post('teams')
  createTeam(@Body() body: CreateTeamDto) {
    return todo('POST /teams');
  }

  @Post('teams/members')
  addTeamMember(@Body() body: AddTeamMemberDto) {
    return todo('POST /teams/members');
  }

  @Post('projects')
  createProject(@Body() body: CreateProjectDto) {
    return todo('POST /projects');
  }

  @Get('projects/:id')
  getProject(@Param('id') id: string) {
    return todo('GET /projects/:id');
  }
}
