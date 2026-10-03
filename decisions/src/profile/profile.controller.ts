import { Controller, Body, Get, Put, Query, UseGuards } from '@nestjs/common';
import { XUserGuard } from '../common/x-user.guard.js';
import { todo } from '../helpers/errors/todo.js';
import { ProfileQueryDto } from './dto/profile-query.dto.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';

@Controller('profile')
@UseGuards(XUserGuard)
export class ProfileController {
  @Get()
  get(@Query() query: ProfileQueryDto) {
    return todo('GET /profile');
  }

  @Put()
  set(@Query() query: ProfileQueryDto, @Body() body: UpdateProfileDto) {
    return todo('PUT /profile');
  }
}
