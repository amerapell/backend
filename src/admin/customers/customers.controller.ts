import { BadRequestException, Get, Param, Query } from '@nestjs/common';
import { parsePage } from '../../common/pagination';
import { AdminController } from '../admin-controller.decorator';
import { CUSTOMER_SORTS, CustomerSort } from './customer-aggregation';
import { AdminCustomersService } from './customers.service';

@AdminController('customers')
export class AdminCustomersController {
  constructor(private readonly customers: AdminCustomersService) {}

  @Get()
  list(@Query() q: Record<string, string | undefined>) {
    const sort = (q.sort || 'recent') as CustomerSort;
    if (!CUSTOMER_SORTS.includes(sort)) throw new BadRequestException('Invalid sort');
    return this.customers.list({ q: q.q?.trim().slice(0, 200) || undefined, sort, ...parsePage(q.page, q.pageSize, 25, 100) });
  }

  /** `:email` is URL-encoded by the client; Express decodes it. */
  @Get(':email')
  get(@Param('email') email: string) {
    if (!email || !email.includes('@') || email.length > 320) throw new BadRequestException('Invalid email');
    return this.customers.detail(email);
  }
}
