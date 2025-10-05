import { Module } from '@nestjs/common';
import { MCPService } from './mcp.service';
import { MCPController } from './mcp.controller';

@Module({
  providers: [MCPService],
  controllers: [MCPController],
  exports: [MCPService],
})
export class MCPModule {}
