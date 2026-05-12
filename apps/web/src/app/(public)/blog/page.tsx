import React from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { BlogInlineAd } from '@/components/ads/BlogInlineAd';

export const metadata: Metadata = {
  title: 'Blog',
  description: 'Legal tech insights, Philippine law updates, and platform news from LIBERTASIAN.',
};

interface BlogTag {
  id: string;
  name: string;
  slug: string;
  color: string | null;
}

interface BlogPost {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  coverImageUrl: string | null;
  coverImageAlt: string | null;
  publishedAt: string | null;
  readTimeMinutes: number | null;
  featured: boolean;
  author: { id: string; fullName: string };
  tags: BlogTag[];
}

async function getBlogPosts(tag?: string): Promise<{
  items: BlogPost[];
  hasNext: boolean;
  nextCursor?: string;
}> {
  const apiUrl = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';
  const params = new URLSearchParams({ limit: '12' });
  if (tag) params.set('tag', tag);

  try {
    const res = await fetch(`${apiUrl}/blog?${params.toString()}`, {
      next: { revalidate: 300 },
    });
    if (!res.ok) return { items: [], hasNext: false };
    const json = await res.json();
    return { items: json.data ?? [], hasNext: json.meta?.hasNext ?? false, nextCursor: json.meta?.nextCursor };
  } catch {
    return { items: [], hasNext: false };
  }
}

async function getBlogTags(): Promise<BlogTag[]> {
  const apiUrl = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';
  try {
    const res = await fetch(`${apiUrl}/blog/tags`, { next: { revalidate: 300 } });
    if (!res.ok) return [];
    const json = await res.json();
    return json.data ?? [];
  } catch {
    return [];
  }
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export default async function BlogListingPage({
  searchParams,
}: {
  searchParams: Promise<{ tag?: string }>;
}) {
  const params = await searchParams;
  const activeTag = params.tag;
  const [{ items: posts }, tags] = await Promise.all([
    getBlogPosts(activeTag),
    getBlogTags(),
  ]);

  return (
    <div className="mx-auto max-w-7xl px-6 py-16">
      {/* Hero */}
      <div className="mb-12 text-center">
        <h1 className="text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl">
          LIBERTASIAN Blog
        </h1>
        <p className="mt-4 text-lg text-gray-600">
          Legal tech insights, Philippine law updates, and platform news
        </p>
      </div>

      {/* Tag Filter */}
      {tags.length > 0 && (
        <div className="mb-10 flex flex-wrap justify-center gap-2">
          <Link
            href="/blog"
            className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
              !activeTag
                ? 'border-gray-900 bg-gray-900 text-white'
                : 'border-gray-300 bg-white text-gray-600 hover:border-gray-400'
            }`}
          >
            All
          </Link>
          {tags.map((tag) => (
            <Link
              key={tag.id}
              href={`/blog?tag=${tag.slug}`}
              className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
                activeTag === tag.slug
                  ? 'border-gray-900 bg-gray-900 text-white'
                  : 'border-gray-300 bg-white text-gray-600 hover:border-gray-400'
              }`}
            >
              {tag.name}
            </Link>
          ))}
        </div>
      )}

      {/* Posts Grid */}
      {posts.length === 0 ? (
        <div className="py-20 text-center">
          <p className="text-gray-500">No blog posts yet. Check back soon!</p>
        </div>
      ) : (
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {posts.map((post, idx) => (
            <React.Fragment key={post.id}>
              <Link
                href={`/blog/${post.slug}`}
                className="group overflow-hidden rounded-xl border border-gray-200 bg-white transition-shadow hover:shadow-md"
              >
                {/* Cover Image */}
                <div className="aspect-[16/9] overflow-hidden bg-gradient-to-br from-gray-100 to-gray-200">
                  {post.coverImageUrl ? (
                    <img
                      src={post.coverImageUrl}
                      alt={post.coverImageAlt || post.title}
                      className="h-full w-full object-cover transition-transform group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      <span className="text-4xl text-gray-300">
                        {post.title.charAt(0).toUpperCase()}
                      </span>
                    </div>
                  )}
                </div>

                {/* Content */}
                <div className="p-5">
                  {/* Tags */}
                  {post.tags.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {post.tags.map((tag) => (
                        <span
                          key={tag.id}
                          className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600"
                          style={tag.color ? { backgroundColor: `${tag.color}15`, color: tag.color } : undefined}
                        >
                          {tag.name}
                        </span>
                      ))}
                    </div>
                  )}

                  <h2 className="text-lg font-semibold text-gray-900 group-hover:text-gray-700">
                    {post.title}
                  </h2>

                  {post.excerpt && (
                    <p className="mt-2 line-clamp-2 text-sm text-gray-600">
                      {post.excerpt}
                    </p>
                  )}

                  <div className="mt-4 flex items-center gap-3 text-xs text-gray-500">
                    <span>{post.author.fullName}</span>
                    <span>&middot;</span>
                    <span>{formatDate(post.publishedAt)}</span>
                    {post.readTimeMinutes && (
                      <>
                        <span>&middot;</span>
                        <span>{post.readTimeMinutes} min read</span>
                      </>
                    )}
                  </div>
                </div>
              </Link>

              {/* Inline ad after 3rd post */}
              {idx === 2 && (
                <div className="sm:col-span-2 lg:col-span-3">
                  <BlogInlineAd index={0} page="blog" />
                </div>
              )}

              {/* Inline ad after 6th post */}
              {idx === 5 && (
                <div className="sm:col-span-2 lg:col-span-3">
                  <BlogInlineAd index={1} page="blog" />
                </div>
              )}
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
}
