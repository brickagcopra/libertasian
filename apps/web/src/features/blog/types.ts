export interface BlogTag {
  id: string;
  name: string;
  slug: string;
  color: string | null;
  postCount?: number;
}

export interface BlogAuthor {
  id: string;
  fullName: string;
}

export interface BlogPost {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  coverImageUrl: string | null;
  coverImageAlt: string | null;
  status: 'draft' | 'published' | 'archived';
  publishedAt: string | null;
  readTimeMinutes: number | null;
  viewCount: number;
  featured: boolean;
  createdAt: string;
  author: BlogAuthor;
  tags: BlogTag[];
}

export interface BlogPostDetail extends BlogPost {
  content: string;
  metaTitle: string | null;
  metaDescription: string | null;
  authorId: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CreateBlogPostInput {
  title: string;
  excerpt?: string;
  content: string;
  coverImageUrl?: string;
  coverImageAlt?: string;
  metaTitle?: string;
  metaDescription?: string;
  featured?: boolean;
  status?: 'draft' | 'published';
  tagIds?: string[];
}

export interface UpdateBlogPostInput {
  title?: string;
  slug?: string;
  excerpt?: string;
  content?: string;
  coverImageUrl?: string;
  coverImageAlt?: string;
  metaTitle?: string;
  metaDescription?: string;
  featured?: boolean;
  status?: 'draft' | 'published' | 'archived';
  tagIds?: string[];
}
