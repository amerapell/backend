import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { SettingsService } from '../settings/settings.service';
import { listStates } from '../common/nigeria/states';
import { ContentService } from './content.service';
import { ContactDto, DropNotifyDto, NewsletterDto } from './content.dto';

@Controller()
export class ContentController {
  constructor(
    private readonly content: ContentService,
    private readonly settings: SettingsService,
  ) {}

  @Get('settings/public')
  publicSettings() {
    return this.settings.getPublic();
  }

  @Get('delivery-zones')
  zones() {
    return this.content.activeZones();
  }

  /** Addition to the contract: Nigerian states (36 + FCT) with their LGAs, for the checkout address form. */
  @Get('locations/states')
  states() {
    return listStates();
  }

  @Get('faq')
  faq() {
    return this.content.faq();
  }

  @Get('pages/:slug')
  page(@Param('slug') slug: string) {
    return this.content.page(slug);
  }

  @Post('contact')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  contact(@Body() dto: ContactDto) {
    return this.content.contact(dto);
  }

  @Post('newsletter')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  newsletter(@Body() dto: NewsletterDto) {
    return this.content.newsletter(dto.email, dto.consent);
  }

  @Post('drops/notify')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  notify(@Body() dto: DropNotifyDto) {
    return this.content.notifyDrop(dto.contact, dto.collectionSlug);
  }
}
