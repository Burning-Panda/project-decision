import { Controller, Body, Get, Put, Query, UseGuards } from '@nestjs/common';
import { XUserGuard } from '../common/x-user.guard';
import { todo } from '../helpers/errors/todo';
import { ProfileQueryDto } from './dto/profile-query.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';

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
