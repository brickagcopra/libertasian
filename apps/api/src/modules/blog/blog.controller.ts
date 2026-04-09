import {
  Controller,
  Get,
  Param,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { BlogService } from './blog.service';
import { BlogQueryDto } from './dto';

@ApiTags('Blog')
@Controller('blog')
export class BlogController {
  constructor(private readonly blogService: BlogService) {}

  @Get()
  @ApiOperation({ summary: 'List published blog posts' })
  async listPublishedPosts(@Query() query: BlogQueryDto) {
    const result = await this.blogService.getPublishedPosts(query);
    return {
      success: true,
      data: result.items,
      meta: { hasNext: result.hasNext, nextCursor: result.nextCursor },
    };
  }

  @Get('tags')
  @ApiOperation({ summary: 'List tags with published posts' })
  async listPublishedTags() {
    const data = await this.blogService.getPublishedTags();
    return { success: true, data };
  }

  @Get(':slug')
  @ApiOperation({ summary: 'Get published blog post by slug' })
  async getPostBySlug(@Param('slug') slug: string) {
    const data = await this.blogService.getPublishedPostBySlug(slug);
    return { success: true, data };
  }
}
