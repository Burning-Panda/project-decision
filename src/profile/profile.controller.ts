import { Controller, Body, Get, Put, Query, UseGuards } from '@nestjs/common';
import { XUserGuard } from '../common/x-user.guard';
import { NotImplementedError } from '../common/errors';
import { ProfileQueryDto } from './dto/profile-query.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Controller('profile')
@UseGuards(XUserGuard)
export class ProfileController {
  @Get()
  get(@Query() query: ProfileQueryDto) {
    throw new NotImplementedError('GET /profile');
  }

  @Put()
  set(@Query() query: ProfileQueryDto, @Body() body: UpdateProfileDto) {
    throw new NotImplementedError('PUT /profile');
  }
}
