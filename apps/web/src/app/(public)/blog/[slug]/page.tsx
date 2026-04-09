import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { SafeHtmlContent } from '@/components/safe-html-content';
import { BlogInlineAd } from '@/components/ads/BlogInlineAd';

interface BlogTag {
  id: string;
  name: string;
  slug: string;
  color: string | null;
}

interface BlogPostDetail {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  content: string;
  coverImageUrl: string | null;
  coverImageAlt: string | null;
  publishedAt: string | null;
  readTimeMinutes: number | null;
  viewCount: number;
  metaTitle: string | null;
  metaDescription: string | null;
  author: { id: string; fullName: string };
  tags: BlogTag[];
}

const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

async function getPost(slug: string): Promise<BlogPostDetail | null> {
  try {
    const res = await fetch(`${API_URL}/blog/${slug}`, {
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.data ?? null;
  } catch {
    return null;
  }
}

async function getRelatedPosts(tags: BlogTag[], currentSlug: string): Promise<BlogPostDetail[]> {
  if (tags.length === 0) return [];
  try {
    const res = await fetch(`${API_URL}/blog?tag=${tags[0].slug}&limit=4`, {
      next: { revalidate: 300 },
    });
    if (!res.ok) return [];
    const json = await res.json();
    const posts: BlogPostDetail[] = json.data ?? [];
    return posts.filter((p) => p.slug !== currentSlug).slice(0, 3);
  } catch {
    return [];
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPost(slug);
  if (!post) {
    return { title: 'Post Not Found — LIBERTASIAN Blog' };
  }

  return {
    title: post.metaTitle || `${post.title} — LIBERTASIAN Blog`,
    description: post.metaDescription || post.excerpt || undefined,
    openGraph: {
      title: post.metaTitle || post.title,
      description: post.metaDescription || post.excerpt || undefined,
      ...(post.coverImageUrl && { images: [{ url: post.coverImageUrl }] }),
    },
  };
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = await getPost(slug);

  if (!post) {
    notFound();
  }

  const relatedPosts = await getRelatedPosts(post.tags, post.slug);

  return (
    <article className="mx-auto max-w-4xl px-6 py-16">
      {/* Breadcrumb */}
      <nav className="mb-8 flex items-center gap-2 text-sm text-gray-500">
        <Link href="/blog" className="hover:text-gray-700">
          Blog
        </Link>
        <span>/</span>
        <span className="truncate text-gray-900">{post.title}</span>
      </nav>

      {/* Cover Image */}
      {post.coverImageUrl && (
        <div className="mb-8 overflow-hidden rounded-xl">
          <img
            src={post.coverImageUrl}
            alt={post.coverImageAlt || post.title}
            className="max-h-96 w-full object-cover"
          />
        </div>
      )}

      {/* Header */}
      <header className="mb-8">
        <h1 className="text-4xl font-bold tracking-tight text-gray-900">
          {post.title}
        </h1>

        <div className="mt-4 flex flex-wrap items-center gap-4 text-sm text-gray-600">
          <span className="font-medium">{post.author.fullName}</span>
          <span>&middot;</span>
          <time>{formatDate(post.publishedAt)}</time>
          {post.readTimeMinutes && (
            <>
              <span>&middot;</span>
              <span>{post.readTimeMinutes} min read</span>
            </>
          )}
        </div>

        {/* Tags */}
        {post.tags.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {post.tags.map((tag) => (
              <Link
                key={tag.id}
                href={`/blog?tag=${tag.slug}`}
                className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-200"
                style={tag.color ? { backgroundColor: `${tag.color}15`, color: tag.color } : undefined}
              >
                {tag.name}
              </Link>
            ))}
          </div>
        )}
      </header>

      {/* Content — sanitized via DOMPurify to prevent XSS */}
      <SafeHtmlContent html={post.content} className="prose prose-gray max-w-none" />

      {/* Inline ad placement */}
      <BlogInlineAd index={0} page="blog-post" />

      {/* Back link */}
      <div className="mt-12 border-t border-gray-200 pt-8">
        <Link
          href="/blog"
          className="text-sm font-medium text-gray-600 hover:text-gray-900"
        >
          &larr; Back to Blog
        </Link>
      </div>

      {/* Related Posts */}
      {relatedPosts.length > 0 && (
        <section className="mt-12 border-t border-gray-200 pt-8">
          <h2 className="mb-6 text-2xl font-bold text-gray-900">Related Posts</h2>
          <div className="grid gap-6 sm:grid-cols-3">
            {relatedPosts.map((related) => (
              <Link
                key={related.id}
                href={`/blog/${related.slug}`}
                className="group overflow-hidden rounded-xl border border-gray-200 bg-white transition-shadow hover:shadow-md"
              >
                <div className="aspect-[16/9] overflow-hidden bg-gradient-to-br from-gray-100 to-gray-200">
                  {related.coverImageUrl ? (
                    <img
                      src={related.coverImageUrl}
                      alt={related.coverImageAlt || related.title}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      <span className="text-3xl text-gray-300">
                        {related.title.charAt(0).toUpperCase()}
                      </span>
                    </div>
                  )}
                </div>
                <div className="p-4">
                  <h3 className="text-sm font-semibold text-gray-900 group-hover:text-gray-700">
                    {related.title}
                  </h3>
                  <p className="mt-1 text-xs text-gray-500">
                    {formatDate(related.publishedAt)}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </article>
  );
}
