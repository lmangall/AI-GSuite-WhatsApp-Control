import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { WhapiModule } from './whapi/whapi.module';
import { MCPModule } from './mcp/mcp.module';
import { GeminiModule } from './gemini/gemini.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    MCPModule,
    GeminiModule,
    WhapiModule,
  ],
})
export class AppModule {}