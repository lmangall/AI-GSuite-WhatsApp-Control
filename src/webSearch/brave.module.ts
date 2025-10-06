import { Module } from '@nestjs/common';
import { BraveService } from './brave.service';
import { HttpModule } from '@nestjs/axios';

@Module({
  imports: [HttpModule],
  providers: [BraveService],
  exports: [BraveService],
})
export class BraveModule {}
