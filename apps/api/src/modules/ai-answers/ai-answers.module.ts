import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { AiAnswersController } from './ai-answers.controller';
import { AiAnswersService } from './ai-answers.service';

@Module({
  imports: [PrismaModule],
  controllers: [AiAnswersController],
  providers: [AiAnswersService],
  exports: [AiAnswersService],
})
export class AiAnswersModule {}
