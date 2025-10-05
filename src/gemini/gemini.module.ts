import { Module } from '@nestjs/common';
import { GeminiService } from './gemini.service';
import { MCPModule } from '../mcp/mcp.module';

@Module({
  imports: [MCPModule],
  providers: [GeminiService],
  exports: [GeminiService],
})
export class GeminiModule {}