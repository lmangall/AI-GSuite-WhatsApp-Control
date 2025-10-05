import { Module } from '@nestjs/common';
import { WebhookController } from './webhook.controller';
import { WhapiService } from './whapi.service';
import { GeminiModule } from '../gemini/gemini.module';

@Module({
  imports: [GeminiModule],
  controllers: [WebhookController],
  providers: [WhapiService],
  exports: [WhapiService],
})
export class WhapiModule {}