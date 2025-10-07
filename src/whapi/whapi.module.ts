import { Module } from '@nestjs/common';
import { WebhookController } from './webhook.controller';
import { WhapiService } from './whapi.service';
import { AgentModule } from '../agent/agent.module';
import { LangChainModule } from '../langchain/langchain.module';

@Module({
  imports: [AgentModule, LangChainModule],
  controllers: [WebhookController],
  providers: [WhapiService],
  exports: [WhapiService],
})
export class WhapiModule {}