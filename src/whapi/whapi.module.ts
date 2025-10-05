import { Module } from '@nestjs/common';
import { WebhookController } from './webhook.controller';
import { WhapiService } from './whapi.service';
import { MCPModule } from '../mcp/mcp.module';

@Module({
  imports: [MCPModule],
  controllers: [WebhookController],
  providers: [WhapiService],
  exports: [WhapiService],
})
export class WhapiModule {}