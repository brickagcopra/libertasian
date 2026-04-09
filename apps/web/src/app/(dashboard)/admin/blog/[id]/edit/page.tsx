'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Save, Send, Upload } from 'lucide-react';
import Link from 'next/link';

import {
  useAdminBlogPost,
  useUpdateBlogPost,
  useAdminBlogTags,
  useCreateBlogTag,
  useUploadBlogCover,
} from '@/features/blog/hooks/use-blog';
import type { UpdateBlogPostInput } from '@/features/blog/types';
import { TiptapEditor } from '@/components/editor/tiptap-editor';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';

export default function EditBlogPostPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const { data: post, isLoading } = useAdminBlogPost(id);
  const updateMutation = useUpdateBlogPost();
  const { data: tags } = useAdminBlogTags();
  const createTagMutation = useCreateBlogTag();
  const uploadCoverMutation = useUploadBlogCover();

  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [excerpt, setExcerpt] = useState('');
  const [content, setContent] = useState('');
  const [metaTitle, setMetaTitle] = useState('');
  const [metaDescription, setMetaDescription] = useState('');
  const [featured, setFeatured] = useState(false);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [newTagName, setNewTagName] = useState('');
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (post && !initialized) {
      setTitle(post.title);
      setSlug(post.slug);
      setExcerpt(post.excerpt ?? '');
      setContent(post.content);
      setMetaTitle(post.metaTitle ?? '');
      setMetaDescription(post.metaDescription ?? '');
      setFeatured(post.featured);
      setSelectedTagIds(post.tags.map((t) => t.id));
      setCoverPreview(post.coverImageUrl);
      setInitialized(true);
    }
  }, [post, initialized]);

  const handleToggleTag = (tagId: string) => {
    setSelectedTagIds((prev) =>
      prev.includes(tagId) ? prev.filter((i) => i !== tagId) : [...prev, tagId],
    );
  };

  const handleCreateTag = async () => {
    if (!newTagName.trim()) return;
    const tag = await createTagMutation.mutateAsync({ name: newTagName.trim() });
    setSelectedTagIds((prev) => [...prev, tag.id]);
    setNewTagName('');
  };

  const handleCoverUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const result = await uploadCoverMutation.mutateAsync({ id, file });
    setCoverPreview(result.coverImageUrl);
  };

  const handleSave = async (status?: 'draft' | 'published' | 'archived') => {
    const input: UpdateBlogPostInput & { id: string } = {
      id,
      title,
      slug,
      excerpt: excerpt || undefined,
      content,
      metaTitle: metaTitle || undefined,
      metaDescription: metaDescription || undefined,
      featured,
      tagIds: selectedTagIds,
      ...(status && { status }),
    };

    await updateMutation.mutateAsync(input);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-muted-foreground">Loading post...</p>
      </div>
    );
  }

  if (!post) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-muted-foreground">Post not found</p>
      </div>
    );
  }

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
            <h1 className="text-2xl font-bold">Edit Post</h1>
            <p className="text-sm text-muted-foreground">
              Status: <Badge variant={post.status === 'published' ? 'default' : 'secondary'}>{post.status}</Badge>
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => handleSave()}
            disabled={updateMutation.isPending}
          >
            <Save className="mr-2 h-4 w-4" />
            Save
          </Button>
          {post.status !== 'published' && (
            <Button
              onClick={() => handleSave('published')}
              disabled={!title || !content || updateMutation.isPending}
            >
              <Send className="mr-2 h-4 w-4" />
              Publish
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main Content */}
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardContent className="space-y-4 p-6">
              <div>
                <Label htmlFor="title">Title</Label>
                <Input
                  id="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="mt-1.5 text-lg"
                />
              </div>
              <div>
                <Label htmlFor="slug">Slug</Label>
                <Input
                  id="slug"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  className="mt-1.5 font-mono text-sm"
                />
              </div>
              <div>
                <Label htmlFor="excerpt">Excerpt</Label>
                <textarea
                  id="excerpt"
                  value={excerpt}
                  onChange={(e) => setExcerpt(e.target.value)}
                  maxLength={500}
                  rows={3}
                  className="mt-1.5 w-full rounded-md border px-3 py-2 text-sm"
                />
                <p className="mt-1 text-xs text-muted-foreground">{excerpt.length}/500</p>
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
          {/* Cover Image */}
          <Card>
            <CardHeader>
              <CardTitle>Cover Image</CardTitle>
            </CardHeader>
            <CardContent>
              {coverPreview ? (
                <div className="mb-3 overflow-hidden rounded-lg">
                  <img src={coverPreview} alt="Cover" className="w-full object-cover" />
                </div>
              ) : (
                <div className="mb-3 flex h-32 items-center justify-center rounded-lg border-2 border-dashed border-gray-300">
                  <p className="text-sm text-muted-foreground">No cover image</p>
                </div>
              )}
              <label className="cursor-pointer">
                <Button variant="outline" size="sm" className="w-full" asChild>
                  <span>
                    <Upload className="mr-2 h-4 w-4" />
                    {uploadCoverMutation.isPending ? 'Uploading...' : 'Upload Cover'}
                  </span>
                </Button>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handleCoverUpload}
                  className="hidden"
                />
              </label>
            </CardContent>
          </Card>

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
                  maxLength={160}
                  className="mt-1.5"
                />
                <p className="mt-1 text-xs text-muted-foreground">{metaTitle.length}/160</p>
              </div>
              <div>
                <Label htmlFor="metaDescription">Meta Description</Label>
                <textarea
                  id="metaDescription"
                  value={metaDescription}
                  onChange={(e) => setMetaDescription(e.target.value)}
                  maxLength={320}
                  rows={3}
                  className="mt-1.5 w-full rounded-md border px-3 py-2 text-sm"
                />
                <p className="mt-1 text-xs text-muted-foreground">{metaDescription.length}/320</p>
              </div>
            </CardContent>
          </Card>

          {/* Featured */}
          <Card>
            <CardContent className="flex items-center justify-between p-6">
              <div>
                <p className="font-medium">Featured Post</p>
                <p className="text-sm text-muted-foreground">Show in featured section</p>
              </div>
              <Switch checked={featured} onCheckedChange={setFeatured} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
