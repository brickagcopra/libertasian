'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus } from 'lucide-react';

import { useSources, useCreateSource } from '@/features/admin/hooks/use-admin';
import { AdminListSkeleton } from '@/components/ui/skeleton';
import { ApiClientError } from '@/lib/api-client';
import { ROUTES } from '@/lib/constants';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const SOURCE_TYPES = ['official', 'semi_official', 'editorial', 'user_upload', 'camera_capture'] as const;
const TRUST_LEVELS = ['high', 'medium', 'low'] as const;
const FETCH_STRATEGIES = ['crawler', 'manual', 'api', 'upload'] as const;

const createSourceSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  type: z.string().min(1, 'Type is required'),
  domain: z.string().max(255).optional(),
  trustLevel: z.string().optional(),
  fetchStrategy: z.string().optional(),
});

type CreateSourceForm = z.infer<typeof createSourceSchema>;

const typeVariants: Record<string, string> = {
  official: 'bg-green-100 text-green-700',
  semi_official: 'bg-blue-100 text-blue-700',
  editorial: 'bg-purple-100 text-purple-700',
  user_upload: 'bg-muted text-muted-foreground',
  camera_capture: 'bg-orange-100 text-orange-700',
};

const trustVariants: Record<string, string> = {
  high: 'bg-green-100 text-green-700',
  medium: 'bg-yellow-100 text-yellow-700',
  low: 'bg-red-100 text-red-700',
};

export default function SourcesPage() {
  const { data: sources, isLoading, error } = useSources();
  const createSource = useCreateSource();
  const [showCreate, setShowCreate] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
    setError,
    setValue,
  } = useForm<CreateSourceForm>({
    resolver: zodResolver(createSourceSchema),
    defaultValues: { trustLevel: 'medium', fetchStrategy: 'crawler' },
  });

  const onSubmit = async (data: CreateSourceForm) => {
    try {
      setSuccessMsg('');
      await createSource.mutateAsync({
        name: data.name,
        type: data.type,
        domain: data.domain || undefined,
        trustLevel: data.trustLevel,
        fetchStrategy: data.fetchStrategy,
      });
      setSuccessMsg(`Source "${data.name}" created.`);
      reset();
      setShowCreate(false);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError('root', { message: err.message });
      } else {
        setError('root', { message: 'Failed to create source' });
      }
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Sources</h1>
          <p className="mt-1 text-sm text-muted-foreground">Manage source registry and endpoints</p>
        </div>
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-1.5 h-4 w-4" />
              Add Source
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Create Source</DialogTitle>
              <DialogDescription>
                Add a new source to the registry for document ingestion.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              {errors.root && (
                <Alert variant="destructive">
                  <AlertDescription>{errors.root.message}</AlertDescription>
                </Alert>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="source-name">Name</Label>
                  <Input
                    id="source-name"
                    {...register('name')}
                    className="mt-1"
                    placeholder="Supreme Court E-Library"
                  />
                  {errors.name && <p className="mt-1 text-xs text-destructive">{errors.name.message}</p>}
                </div>

                <div>
                  <Label htmlFor="source-type">Type</Label>
                  <Select onValueChange={(val) => setValue('type', val)}>
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Select type..." />
                    </SelectTrigger>
                    <SelectContent>
                      {SOURCE_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>{t.replace('_', ' ')}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {errors.type && <p className="mt-1 text-xs text-destructive">{errors.type.message}</p>}
                </div>

                <div>
                  <Label htmlFor="source-domain">Domain (optional)</Label>
                  <Input
                    id="source-domain"
                    {...register('domain')}
                    className="mt-1"
                    placeholder="elibrary.judiciary.gov.ph"
                  />
                </div>

                <div>
                  <Label htmlFor="source-trust">Trust Level</Label>
                  <Select defaultValue="medium" onValueChange={(val) => setValue('trustLevel', val)}>
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TRUST_LEVELS.map((l) => (
                        <SelectItem key={l} value={l}>{l}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="source-fetch">Fetch Strategy</Label>
                  <Select defaultValue="crawler" onValueChange={(val) => setValue('fetchStrategy', val)}>
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FETCH_STRATEGIES.map((s) => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Creating...' : 'Create Source'}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>
            {error instanceof Error ? error.message : 'Failed to load sources'}
          </AlertDescription>
        </Alert>
      )}
      {successMsg && (
        <Alert>
          <AlertDescription className="text-green-700">{successMsg}</AlertDescription>
        </Alert>
      )}

      {/* Sources List */}
      {isLoading ? (
        <AdminListSkeleton />
      ) : sources && sources.length > 0 ? (
        <Card>
          <div className="divide-y">
            {sources.map((source) => (
              <Link
                key={source.id}
                href={ROUTES.ADMIN_SOURCE(source.id)}
                className="flex items-center justify-between px-4 py-3 hover:bg-muted/50"
              >
                <div>
                  <p className="text-sm font-medium">{source.name}</p>
                  <div className="mt-1 flex flex-wrap gap-2">
                    <Badge className={typeVariants[source.type] ?? 'bg-muted text-muted-foreground'}>
                      {source.type.replace('_', ' ')}
                    </Badge>
                    <Badge className={trustVariants[source.trustLevel] ?? 'bg-muted text-muted-foreground'}>
                      {source.trustLevel} trust
                    </Badge>
                    {source.domain && (
                      <span className="text-xs text-muted-foreground">{source.domain}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span>{source._count.legalDocuments} docs</span>
                  <span>{source._count.endpoints} endpoints</span>
                  <Badge className={source.enabled ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}>
                    {source.enabled ? 'enabled' : 'disabled'}
                  </Badge>
                </div>
              </Link>
            ))}
          </div>
        </Card>
      ) : (
        <p className="py-8 text-center text-sm text-muted-foreground">No sources registered yet.</p>
      )}
    </div>
  );
}
