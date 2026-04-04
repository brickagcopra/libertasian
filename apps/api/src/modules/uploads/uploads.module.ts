import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { DigestsModule } from '../digests/digests.module';
import { SearchModule } from '../search/search.module';
import { ClamavService } from './clamav.service';
import { OcrClientService } from './ocr-client.service';
import { S3Service } from './s3.service';
import { UploadsController } from './uploads.controller';
import { UploadsProcessor } from './uploads.processor';
import { UploadsService } from './uploads.service';
import { UserUploadSearchService } from './user-upload-search.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'uploads' }),
    DigestsModule,
    SearchModule,
  ],
  controllers: [UploadsController],
  providers: [ClamavService, S3Service, OcrClientService, UploadsService, UploadsProcessor, UserUploadSearchService],
  exports: [UploadsService, S3Service, UserUploadSearchService, ClamavService],
})
export class UploadsModule {}
