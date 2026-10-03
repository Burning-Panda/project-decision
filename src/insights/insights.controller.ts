import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { XUserGuard } from '../common/x-user.guard';
import { todo } from '../helpers/errors/todo';
import { SearchQueryDto } from './dto/search-query.dto';
import { ReportQueryDto } from './dto/report-query.dto';
import { ExportQueryDto } from './dto/export-query.dto';

@Controller()
@UseGuards(XUserGuard)
export class InsightsController {
  @Get('search')
  search(@Query() query: SearchQueryDto) {
    return todo('GET /search');
  }

  @Get('dashboard')
  dashboard() {
    return todo('GET /dashboard');
  }

  @Get('notifications')
  notifications() {
    return todo('GET /notifications');
  }

  @Get('reports/:type')
  report(@Param('type') type: string, @Query() query: ReportQueryDto) {
    return todo('GET /reports/:type');
  }

  @Get('export')
  export(@Query() query: ExportQueryDto) {
    return todo('GET /export');
  }
}
