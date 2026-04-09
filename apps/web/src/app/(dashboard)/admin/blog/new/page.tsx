'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Save, Send } from 'lucide-react';
import Link from 'next/link';

import {
  useCreateBlogPost,
  useAdminBlogTags,
  useCreateBlogTag,
} from '@/features/blog/hooks/use-blog';
import type { CreateBlogPostInput } from '@/features/blog/types';
import { TiptapEditor } from '@/components/editor/tiptap-editor';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export default function NewBlogPostPage() {
  const router = useRouter();
  const createMutation = useCreateBlogPost();
  const { data: tags } = useAdminBlogTags();
  const createTagMutation = useCreateBlogTag();

  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [autoSlug, setAutoSlug] = useState(true);
  const [excerpt, setExcerpt] = useState('');
  const [content, setContent] = useState('');
  const [metaTitle, setMetaTitle] = useState('');
  const [metaDescription, setMetaDescription] = useState('');
  const [featured, setFeatured] = useState(false);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [newTagName, setNewTagName] = useState('');

  const handleTitleChange = (value: string) => {
    setTitle(value);
    if (autoSlug) {
      setSlug(slugify(value));
    }
  };

  const handleToggleTag = (tagId: string) => {
    setSelectedTagIds((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId],
    );
  };

  const handleCreateTag = async () => {
    if (!newTagName.trim()) return;
    const tag = await createTagMutation.mutateAsync({ name: newTagName.trim() });
    setSelectedTagIds((prev) => [...prev, tag.id]);
    setNewTagName('');
  };

  const handleSave = async (status: 'draft' | 'published') => {
    const input: CreateBlogPostInput = {
      title,
      excerpt: excerpt || undefined,
      content,
      metaTitle: metaTitle || undefined,
      metaDescription: metaDescription || undefined,
      featured,
      status,
      tagIds: selectedTagIds.length > 0 ? selectedTagIds : undefined,
    };

    const post = await createMutation.mutateAsync(input);
    router.push(`/admin/blog/${post.id}/edit`);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/admin/blog">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold">New Blog Post</h1>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => handleSave('draft')}
            disabled={!title || !content || createMutation.isPending}
          >
            <Save className="mr-2 h-4 w-4" />
            Save Draft
          </Button>
          <Button
            onClick={() => handleSave('published')}
            disabled={!title || !content || createMutation.isPending}
          >
            <Send className="mr-2 h-4 w-4" />
            Publish
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main Content */}
        <div className="space-y-6 lg:col-span-2">
          {/* Title */}
          <Card>
            <CardContent className="space-y-4 p-6">
              <div>
                <Label htmlFor="title">Title</Label>
                <Input
                  id="title"
                  value={title}
                  onChange={(e) => handleTitleChange(e.target.value)}
                  placeholder="Post title..."
                  className="mt-1.5 text-lg"
                />
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="slug">Slug</Label>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={autoSlug}
                      onChange={(e) => setAutoSlug(e.target.checked)}
                      className="rounded"
                    />
                    Auto-generate
                  </label>
                </div>
                <Input
                  id="slug"
                  value={slug}
                  onChange={(e) => {
                    setAutoSlug(false);
                    setSlug(e.target.value);
                  }}
                  placeholder="post-slug"
                  className="mt-1.5 font-mono text-sm"
                />
              </div>
              <div>
                <Label htmlFor="excerpt">Excerpt</Label>
                <textarea
                  id="excerpt"
                  value={excerpt}
                  onChange={(e) => setExcerpt(e.target.value)}
                  placeholder="Brief summary (shown in blog listing)..."
                  maxLength={500}
                  rows={3}
                  className="mt-1.5 w-full rounded-md border px-3 py-2 text-sm"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  {excerpt.length}/500 characters
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Content Editor */}
          <Card>
            <CardHeader>
              <CardTitle>Content</CardTitle>
            </CardHeader>
            <CardContent>
              <TiptapEditor
                content={content}
                onChange={setContent}
                placeholder="Write your blog post..."
              />
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Tags */}
          <Card>
            <CardHeader>
              <CardTitle>Tags</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {tags?.map((tag) => (
                  <Badge
                    key={tag.id}
                    variant={selectedTagIds.includes(tag.id) ? 'default' : 'outline'}
                    className="cursor-pointer"
                    onClick={() => handleToggleTag(tag.id)}
                  >
                    {tag.name}
                  </Badge>
                ))}
              </div>
              <div className="flex gap-2">
                <Input
                  value={newTagName}
                  onChange={(e) => setNewTagName(e.target.value)}
                  placeholder="New tag..."
                  className="text-sm"
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateTag()}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCreateTag}
                  disabled={!newTagName.trim() || createTagMutation.isPending}
                >
                  Add
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* SEO */}
          <Card>
            <CardHeader>
              <CardTitle>SEO</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="metaTitle">Meta Title</Label>
                <Input
                  id="metaTitle"
                  value={metaTitle}
                  onChange={(e) => setMetaTitle(e.target.value)}
                  placeholder="SEO title (defaults to post title)"
                  maxLength={160}
                  className="mt-1.5"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  {metaTitle.length}/160
                </p>
              </div>
              <div>
                <Label htmlFor="metaDescription">Meta Description</Label>
                <textarea
                  id="metaDescription"
                  value={metaDescription}
                  onChange={(e) => setMetaDescription(e.target.value)}
                  placeholder="SEO description..."
                  maxLength={320}
                  rows={3}
                  className="mt-1.5 w-full rounded-md border px-3 py-2 text-sm"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  {metaDescription.length}/320
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Featured */}
          <Card>
            <CardContent className="flex items-center justify-between p-6">
              <div>
                <p className="font-medium">Featured Post</p>
                <p className="text-sm text-muted-foreground">
                  Show this post in featured section
                </p>
              </div>
              <Switch checked={featured} onCheckedChange={setFeatured} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
