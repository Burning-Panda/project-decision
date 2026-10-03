import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { XUserGuard } from '../common/x-user.guard';
import { NotImplementedError } from '../common/errors';
import { SearchQueryDto } from './dto/search-query.dto';
import { ReportQueryDto } from './dto/report-query.dto';
import { ExportQueryDto } from './dto/export-query.dto';

@Controller()
@UseGuards(XUserGuard)
export class InsightsController {
  @Get('search')
  search(@Query() query: SearchQueryDto) {
    throw new NotImplementedError('GET /search');
  }

  @Get('dashboard')
  dashboard() {
    throw new NotImplementedError('GET /dashboard');
  }

  @Get('notifications')
  notifications() {
    throw new NotImplementedError('GET /notifications');
  }

  @Get('reports/:type')
  report(@Param('type') type: string, @Query() query: ReportQueryDto) {
    throw new NotImplementedError('GET /reports/:type');
  }

  @Get('export')
  export(@Query() query: ExportQueryDto) {
    throw new NotImplementedError('GET /export');
  }
}
