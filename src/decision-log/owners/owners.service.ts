import { Injectable } from '@nestjs/common';
import { todo } from '../../helpers/errors/todo.js';
import type { CreateOwnerDto } from '../../admin/dto/create-owner.dto.js';
import { AuditService } from '../core/audit.service.js';
import { LogContext } from '../core/log-context.js';
import type { Owner } from './owner.js';

@Injectable()
export class OwnersService {
  constructor(private readonly ctx: LogContext, private readonly audit: AuditService) {}

  /** Creates the owner and its empty `default` team. INVALID without identifier, CONFLICT if taken. */
  create(_input: CreateOwnerDto): Owner {
    return todo('OwnersService.create');
  }

  /** NOT_FOUND when absent. Shared guard for every service that takes an `owner`. */
  require(_identifier: string): Owner {
    return todo('OwnersService.require');
  }
}
