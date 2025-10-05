import { Module } from '@nestjs/common';
import { WebhookController } from './webhook.controller';
import { WhapiService } from './whapi.service';

@Module({
  controllers: [WebhookController],
  providers: [WhapiService],
  exports: [WhapiService], // Export if other modules need it
})
export class WhapiModule {}
