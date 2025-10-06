import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { WhapiModule } from './whapi/whapi.module';
import { MCPModule } from './mcp/mcp.module';
import { AgentModule } from './agent/agent.module';
import { BraveModule } from './brave/brave.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    MCPModule,
    AgentModule,
    WhapiModule,
    BraveModule,
  ],
})
export class AppModule {}