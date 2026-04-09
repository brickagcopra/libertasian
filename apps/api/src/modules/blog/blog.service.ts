import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { CreateBlogPostDto, UpdateBlogPostDto, BlogQueryDto, CreateTagDto } from './dto';

const AUTHOR_SELECT = {
  select: {
    id: true,
    fullName: true,
  },
} as const;

const TAG_SELECT = {
  select: {
    tag: {
      select: {
        id: true,
        name: true,
        slug: true,
        color: true,
      },
    },
  },
} as const;

const BLOG_POST_LIST_SELECT = {
  id: true,
  slug: true,
  title: true,
  excerpt: true,
  coverImageUrl: true,
  coverImageAlt: true,
  status: true,
  publishedAt: true,
  readTimeMinutes: true,
  viewCount: true,
  featured: true,
  createdAt: true,
  author: AUTHOR_SELECT,
  tags: TAG_SELECT,
} as const;

const BLOG_POST_DETAIL_SELECT = {
  ...BLOG_POST_LIST_SELECT,
  content: true,
  metaTitle: true,
  metaDescription: true,
  authorId: true,
  updatedAt: true,
  deletedAt: true,
} as const;

@Injectable()
export class BlogService {
  private readonly logger = new Logger(BlogService.name);

  constructor(private readonly prisma: PrismaService) {}

  // =========================================================================
  // Public Endpoints
  // =========================================================================

  async getPublishedPosts(query: BlogQueryDto) {
    const limit = query.limit ?? 12;

    const where: Record<string, unknown> = {
      status: 'published',
      deletedAt: null,
      publishedAt: { not: null },
    };

    if (query.tag) {
      where['tags'] = { some: { tag: { slug: query.tag } } };
    }

    const items = await this.prisma.blogPost.findMany({
      take: limit + 1,
      ...(query.cursor && { skip: 1, cursor: { id: query.cursor } }),
      where,
      select: BLOG_POST_LIST_SELECT,
      orderBy: { publishedAt: 'desc' },
    });

    const hasNext = items.length > limit;
    const posts = hasNext ? items.slice(0, -1) : items;
    const nextCursor = hasNext ? posts[posts.length - 1]?.id : undefined;

    return {
      items: posts.map((p) => this.formatPost(p)),
      hasNext,
      nextCursor,
    };
  }

  async getPublishedPostBySlug(slug: string) {
    const post = await this.prisma.blogPost.findUnique({
      where: { slug },
      select: BLOG_POST_DETAIL_SELECT,
    });

    if (!post || post.status !== 'published' || post.deletedAt) {
      throw new NotFoundException('Blog post not found');
    }

    // Fire-and-forget view count increment
    this.prisma.blogPost
      .update({ where: { id: post.id }, data: { viewCount: { increment: 1 } } })
      .catch((err) => this.logger.warn(`Failed to increment view count: ${err}`));

    return this.formatPost(post);
  }

  async getPublishedTags() {
    const tags = await this.prisma.blogTag.findMany({
      where: {
        posts: { some: { post: { status: 'published', deletedAt: null } } },
      },
      select: {
        id: true,
        name: true,
        slug: true,
        color: true,
        _count: { select: { posts: true } },
      },
      orderBy: { name: 'asc' },
    });

    return tags.map((t) => ({
      id: t.id,
      name: t.name,
      slug: t.slug,
      color: t.color,
      postCount: t._count.posts,
    }));
  }

  // =========================================================================
  // Admin Endpoints
  // =========================================================================

  async getAdminPosts(query: BlogQueryDto) {
    const limit = query.limit ?? 20;

    const where: Record<string, unknown> = { deletedAt: null };
    if (query.status) {
      where['status'] = query.status;
    }

    const items = await this.prisma.blogPost.findMany({
      take: limit + 1,
      ...(query.cursor && { skip: 1, cursor: { id: query.cursor } }),
      where,
      select: BLOG_POST_DETAIL_SELECT,
      orderBy: { createdAt: 'desc' },
    });

    const hasNext = items.length > limit;
    const posts = hasNext ? items.slice(0, -1) : items;
    const nextCursor = hasNext ? posts[posts.length - 1]?.id : undefined;

    return {
      items: posts.map((p) => this.formatPost(p)),
      hasNext,
      nextCursor,
    };
  }

  async getAdminPost(id: string) {
    const post = await this.prisma.blogPost.findUnique({
      where: { id },
      select: BLOG_POST_DETAIL_SELECT,
    });

    if (!post || post.deletedAt) {
      throw new NotFoundException('Blog post not found');
    }

    return this.formatPost(post);
  }

  async createPost(dto: CreateBlogPostDto, authorId: string) {
    const slug = await this.generateUniqueSlug(dto.title);
    const readTimeMinutes = this.calculateReadTime(dto.content);

    const shouldPublish = dto.status === 'published';

    const post = await this.prisma.blogPost.create({
      data: {
        slug,
        title: dto.title,
        excerpt: dto.excerpt,
        content: dto.content,
        coverImageUrl: dto.coverImageUrl,
        coverImageAlt: dto.coverImageAlt,
        authorId,
        status: dto.status ?? 'draft',
        publishedAt: shouldPublish ? new Date() : null,
        metaTitle: dto.metaTitle,
        metaDescription: dto.metaDescription,
        readTimeMinutes,
        featured: dto.featured ?? false,
        ...(dto.tagIds?.length && {
          tags: {
            create: dto.tagIds.map((tagId) => ({ tagId })),
          },
        }),
      },
      select: BLOG_POST_DETAIL_SELECT,
    });

    return this.formatPost(post);
  }

  async updatePost(id: string, dto: UpdateBlogPostDto) {
    const existing = await this.prisma.blogPost.findUnique({
      where: { id },
      select: { id: true, status: true, publishedAt: true, deletedAt: true },
    });

    if (!existing || existing.deletedAt) {
      throw new NotFoundException('Blog post not found');
    }

    // If slug changed, validate uniqueness
    if (dto.slug) {
      const slugTaken = await this.prisma.blogPost.findFirst({
        where: { slug: dto.slug, id: { not: id } },
      });
      if (slugTaken) {
        throw new BadRequestException('Slug is already taken');
      }
    }

    // Calculate read time if content changed
    const readTimeMinutes = dto.content
      ? this.calculateReadTime(dto.content)
      : undefined;

    // Set publishedAt if transitioning to published
    const isPublishing =
      dto.status === 'published' && existing.status !== 'published' && !existing.publishedAt;

    // Handle tag updates
    if (dto.tagIds !== undefined) {
      await this.prisma.blogPostTag.deleteMany({ where: { postId: id } });
      if (dto.tagIds.length > 0) {
        await this.prisma.blogPostTag.createMany({
          data: dto.tagIds.map((tagId) => ({ postId: id, tagId })),
        });
      }
    }

    const post = await this.prisma.blogPost.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.slug !== undefined && { slug: dto.slug }),
        ...(dto.excerpt !== undefined && { excerpt: dto.excerpt }),
        ...(dto.content !== undefined && { content: dto.content }),
        ...(dto.coverImageUrl !== undefined && { coverImageUrl: dto.coverImageUrl }),
        ...(dto.coverImageAlt !== undefined && { coverImageAlt: dto.coverImageAlt }),
        ...(dto.metaTitle !== undefined && { metaTitle: dto.metaTitle }),
        ...(dto.metaDescription !== undefined && { metaDescription: dto.metaDescription }),
        ...(dto.featured !== undefined && { featured: dto.featured }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(readTimeMinutes !== undefined && { readTimeMinutes }),
        ...(isPublishing && { publishedAt: new Date() }),
      },
      select: BLOG_POST_DETAIL_SELECT,
    });

    return this.formatPost(post);
  }

  async deletePost(id: string) {
    const post = await this.prisma.blogPost.findUnique({
      where: { id },
      select: { id: true, deletedAt: true },
    });

    if (!post) {
      throw new NotFoundException('Blog post not found');
    }

    await this.prisma.blogPost.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'archived' },
    });
  }

  // =========================================================================
  // Tags Management
  // =========================================================================

  async getAllTags() {
    return this.prisma.blogTag.findMany({
      select: {
        id: true,
        name: true,
        slug: true,
        color: true,
        createdAt: true,
        _count: { select: { posts: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  async createTag(dto: CreateTagDto) {
    const slug = this.slugify(dto.name);

    const existing = await this.prisma.blogTag.findFirst({
      where: { OR: [{ name: dto.name }, { slug }] },
    });
    if (existing) {
      throw new BadRequestException('Tag with this name already exists');
    }

    return this.prisma.blogTag.create({
      data: {
        name: dto.name,
        slug,
        color: dto.color,
      },
    });
  }

  async deleteTag(id: string) {
    const tag = await this.prisma.blogTag.findUnique({ where: { id } });
    if (!tag) {
      throw new NotFoundException('Tag not found');
    }

    await this.prisma.blogTag.delete({ where: { id } });
  }

  // =========================================================================
  // Helpers
  // =========================================================================

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  private async generateUniqueSlug(title: string): Promise<string> {
    const baseSlug = this.slugify(title);
    let slug = baseSlug;
    let counter = 1;

    while (true) {
      const existing = await this.prisma.blogPost.findUnique({ where: { slug } });
      if (!existing) return slug;
      counter++;
      slug = `${baseSlug}-${counter}`;
    }
  }

  private calculateReadTime(htmlContent: string): number {
    // Strip HTML tags and count words
    const text = htmlContent.replace(/<[^>]*>/g, '');
    const words = text.split(/\s+/).filter((w) => w.length > 0).length;
    return Math.max(1, Math.ceil(words / 200));
  }

  private formatPost(post: Record<string, unknown>) {
    const tags = post['tags'] as Array<{ tag: Record<string, unknown> }> | undefined;
    return {
      ...post,
      tags: tags?.map((t) => t.tag) ?? [],
    };
  }
}
