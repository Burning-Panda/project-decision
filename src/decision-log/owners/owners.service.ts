import { Injectable } from '@nestjs/common';
import { NotImplementedError } from '../../common/errors';
import type { CreateOwnerDto } from '../../admin/dto/create-owner.dto';
import { AuditService } from '../core/audit.service';
import { LogContext } from '../core/log-context';
import type { Owner } from './owner';

@Injectable()
export class OwnersService {
  constructor(private readonly ctx: LogContext, private readonly audit: AuditService) {}

  /** Creates the owner and its empty `default` team. INVALID without identifier, CONFLICT if taken. */
  create(_input: CreateOwnerDto): Owner {
    throw new NotImplementedError('OwnersService.create');
  }

  /** NOT_FOUND when absent. Shared guard for every service that takes an `owner`. */
  require(_identifier: string): Owner {
    throw new NotImplementedError('OwnersService.require');
  }
}
