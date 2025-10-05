import { Module } from '@nestjs/common';
import { MCPService } from './mcp.service';

@Module({
  providers: [MCPService],
  exports: [MCPService],
})
export class MCPModule {}