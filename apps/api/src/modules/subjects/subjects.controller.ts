import { Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { SubjectsService } from './subjects.service';
import { ListSubjectsQueryDto } from './dto';

@Controller('subjects')
@UseGuards(JwtAuthGuard)
export class SubjectsController {
  constructor(private readonly subjectsService: SubjectsService) {}

  @Get()
  async list(@Query() query: ListSubjectsQueryDto) {
    return this.subjectsService.findAllSubjects(query.taxonomy);
  }

  @Get('coverage')
  async getCoverage() {
    return this.subjectsService.getClassificationCoverage();
  }

  @Get(':id/topics')
  async listTopics(@Param('id', ParseUUIDPipe) id: string) {
    return this.subjectsService.findTopicsBySubject(id);
  }

  @Get('equivalences/:studySubjectId')
  async getEquivalences(@Param('studySubjectId', ParseUUIDPipe) studySubjectId: string) {
    return this.subjectsService.getEquivalences(studySubjectId);
  }

  @Post(':id/reclassify')
  async reclassifySubject(@Param('id', ParseUUIDPipe) _id: string) {
    // Stub for admin-triggered reclassification — will dispatch classification
    // jobs for all documents under this subject in a future PR.
    return { success: true, message: 'Reclassification enqueued (stub)' };
  }
}
