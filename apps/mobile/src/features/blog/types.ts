export interface BlogTag {
  id: string;
  name: string;
  slug: string;
  color: string | null;
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
  publishedAt: string | null;
  readTimeMinutes: number | null;
  viewCount: number;
  author: BlogAuthor;
  tags: BlogTag[];
}

export interface BlogPostDetail extends BlogPost {
  content: string;
  metaTitle: string | null;
  metaDescription: string | null;
}
