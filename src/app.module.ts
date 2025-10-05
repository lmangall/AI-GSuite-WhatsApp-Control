import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { WhapiModule } from './whapi/whapi.module';
import { MCPModule } from './mcp/mcp.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    MCPModule,
    WhapiModule,
  ],
})
export class AppModule {}