'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Play, Pencil, Trash2 } from 'lucide-react';

import {
  useSource,
  useUpdateSource,
  useCreateEndpoint,
  useUpdateEndpoint,
  useDeleteEndpoint,
  useTriggerFetch,
  useIngestionJobs,
} from '@/features/admin/hooks/use-admin';
import type { SourceEndpoint, IngestionJob } from '@/features/admin/types';
import { AdminListSkeleton } from '@/components/ui/skeleton';
import { ApiClientError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
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

export default function SourceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: source, isLoading, error } = useSource(id);

  if (isLoading) return <AdminListSkeleton count={3} />;

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          {error instanceof Error ? error.message : 'Failed to load source'}
        </AlertDescription>
      </Alert>
    );
  }

  if (!source) return null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{source.name}</h1>
        <div className="mt-1 flex flex-wrap gap-2">
          <Badge className={typeVariants[source.type] ?? 'bg-muted text-muted-foreground'}>
            {source.type.replace('_', ' ')}
          </Badge>
          <Badge className={trustVariants[source.trustLevel] ?? 'bg-muted text-muted-foreground'}>
            {source.trustLevel} trust
          </Badge>
          <Badge className={source.enabled ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}>
            {source.enabled ? 'enabled' : 'disabled'}
          </Badge>
          {source.domain && <span className="text-xs text-muted-foreground">{source.domain}</span>}
          <span className="text-xs text-muted-foreground">{source._count.legalDocuments} docs</span>
        </div>
      </div>

      {/* Source Edit Section */}
      <SourceEditForm sourceId={id} source={source} />

      {/* Tabs */}
      <Tabs defaultValue="endpoints">
        <TabsList>
          <TabsTrigger value="endpoints">Endpoints</TabsTrigger>
          <TabsTrigger value="jobs">Ingestion Jobs</TabsTrigger>
        </TabsList>
        <TabsContent value="endpoints">
          <EndpointsTab sourceId={id} endpoints={source.endpoints} />
        </TabsContent>
        <TabsContent value="jobs">
          <IngestionJobsTab sourceId={id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---- Source Edit ----

const TRUST_LEVELS = ['high', 'medium', 'low'] as const;
const FETCH_STRATEGIES = ['crawler', 'manual', 'api', 'upload'] as const;

const updateSourceSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  domain: z.string().max(255).optional(),
  trustLevel: z.string(),
  fetchStrategy: z.string(),
  enabled: z.boolean(),
});

type UpdateSourceForm = z.infer<typeof updateSourceSchema>;

function SourceEditForm({
  sourceId,
  source,
}: {
  sourceId: string;
  source: { name: string; domain: string | null; trustLevel: string; fetchStrategy: string; enabled: boolean };
}) {
  const updateSource = useUpdateSource(sourceId);
  const [showEdit, setShowEdit] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isDirty },
    setError,
    reset,
    setValue,
    watch,
  } = useForm<UpdateSourceForm>({
    resolver: zodResolver(updateSourceSchema),
    values: {
      name: source.name,
      domain: source.domain ?? '',
      trustLevel: source.trustLevel,
      fetchStrategy: source.fetchStrategy,
      enabled: source.enabled,
    },
  });

  const enabledValue = watch('enabled');

  const onSubmit = async (data: UpdateSourceForm) => {
    try {
      setSuccessMsg('');
      await updateSource.mutateAsync({
        name: data.name,
        domain: data.domain || undefined,
        trustLevel: data.trustLevel,
        fetchStrategy: data.fetchStrategy,
        enabled: data.enabled,
      });
      setSuccessMsg('Source updated.');
      setShowEdit(false);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError('root', { message: err.message });
      } else {
        setError('root', { message: 'Failed to update source' });
      }
    }
  };

  if (!showEdit) {
    return (
      <div className="space-y-2">
        {successMsg && (
          <Alert>
            <AlertDescription className="text-green-700">{successMsg}</AlertDescription>
          </Alert>
        )}
        <Button variant="outline" size="sm" onClick={() => { setShowEdit(true); setSuccessMsg(''); }}>
          <Pencil className="mr-1.5 h-3.5 w-3.5" />
          Edit Source
        </Button>
      </div>
    );
  }

  return (
    <Card>
      <CardContent className="p-4">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {errors.root && (
            <Alert variant="destructive">
              <AlertDescription>{errors.root.message}</AlertDescription>
            </Alert>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="edit-name">Name</Label>
              <Input id="edit-name" {...register('name')} className="mt-1" />
              {errors.name && <p className="mt-1 text-xs text-destructive">{errors.name.message}</p>}
            </div>
            <div>
              <Label htmlFor="edit-domain">Domain</Label>
              <Input id="edit-domain" {...register('domain')} className="mt-1" />
            </div>
            <div>
              <Label>Trust Level</Label>
              <Select value={watch('trustLevel')} onValueChange={(val) => setValue('trustLevel', val, { shouldDirty: true })}>
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
              <Label>Fetch Strategy</Label>
              <Select value={watch('fetchStrategy')} onValueChange={(val) => setValue('fetchStrategy', val, { shouldDirty: true })}>
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
            <div className="flex items-center gap-2 sm:col-span-2">
              <Checkbox
                id="edit-enabled"
                checked={enabledValue}
                onCheckedChange={(checked) => setValue('enabled', !!checked, { shouldDirty: true })}
              />
              <Label htmlFor="edit-enabled">Enabled</Label>
            </div>
          </div>

          <div className="flex gap-2">
            <Button type="submit" disabled={isSubmitting || !isDirty}>
              {isSubmitting ? 'Saving...' : 'Save'}
            </Button>
            <Button type="button" variant="outline" onClick={() => { setShowEdit(false); reset(); }}>
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

// ---- Endpoints Tab ----

const createEndpointSchema = z.object({
  endpointUrl: z.string().min(1, 'URL is required'),
  parserType: z.string().min(1, 'Parser type is required').max(50),
  contentTypeHint: z.string().max(50).optional(),
  scheduleCron: z.string().max(100).optional(),
  status: z.string().optional(),
});

type CreateEndpointForm = z.infer<typeof createEndpointSchema>;

function EndpointsTab({
  sourceId,
  endpoints,
}: {
  sourceId: string;
  endpoints: SourceEndpoint[];
}) {
  const createEndpoint = useCreateEndpoint(sourceId);
  const deleteEndpoint = useDeleteEndpoint(sourceId);
  const triggerFetch = useTriggerFetch(sourceId);
  const [showCreate, setShowCreate] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
    setError,
    setValue,
  } = useForm<CreateEndpointForm>({
    resolver: zodResolver(createEndpointSchema),
    defaultValues: { status: 'active' },
  });

  const onSubmit = async (data: CreateEndpointForm) => {
    try {
      setSuccessMsg('');
      await createEndpoint.mutateAsync({
        endpointUrl: data.endpointUrl,
        parserType: data.parserType,
        contentTypeHint: data.contentTypeHint || undefined,
        scheduleCron: data.scheduleCron || undefined,
        status: data.status,
      });
      setSuccessMsg('Endpoint added.');
      reset();
      setShowCreate(false);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError('root', { message: err.message });
      } else {
        setError('root', { message: 'Failed to create endpoint' });
      }
    }
  };

  const handleTriggerFetch = async () => {
    try {
      await triggerFetch.mutateAsync();
      setSuccessMsg('Fetch job triggered.');
    } catch {
      setSuccessMsg('');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Endpoints ({endpoints.length})</h3>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleTriggerFetch} disabled={triggerFetch.isPending}>
            <Play className="mr-1 h-3.5 w-3.5" />
            {triggerFetch.isPending ? 'Triggering...' : 'Trigger Fetch'}
          </Button>
          <Dialog open={showCreate} onOpenChange={setShowCreate}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="mr-1 h-3.5 w-3.5" />
                Add Endpoint
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Endpoint</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
                {errors.root && (
                  <Alert variant="destructive">
                    <AlertDescription>{errors.root.message}</AlertDescription>
                  </Alert>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <Label htmlFor="ep-url">Endpoint URL</Label>
                    <Input
                      id="ep-url"
                      {...register('endpointUrl')}
                      className="mt-1"
                      placeholder="https://elibrary.judiciary.gov.ph/..."
                    />
                    {errors.endpointUrl && <p className="mt-1 text-xs text-destructive">{errors.endpointUrl.message}</p>}
                  </div>
                  <div>
                    <Label htmlFor="ep-parser">Parser Type</Label>
                    <Input id="ep-parser" {...register('parserType')} className="mt-1" placeholder="html_table" />
                    {errors.parserType && <p className="mt-1 text-xs text-destructive">{errors.parserType.message}</p>}
                  </div>
                  <div>
                    <Label htmlFor="ep-content">Content Type Hint</Label>
                    <Input id="ep-content" {...register('contentTypeHint')} className="mt-1" placeholder="decision" />
                  </div>
                  <div>
                    <Label htmlFor="ep-cron">Schedule (cron)</Label>
                    <Input id="ep-cron" {...register('scheduleCron')} className="mt-1" placeholder="0 2 * * *" />
                  </div>
                  <div>
                    <Label>Status</Label>
                    <Select defaultValue="active" onValueChange={(val) => setValue('status', val)}>
                      <SelectTrigger className="mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">active</SelectItem>
                        <SelectItem value="disabled">disabled</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <Button type="submit" size="sm" disabled={isSubmitting}>
                  {isSubmitting ? 'Adding...' : 'Add'}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {successMsg && (
        <Alert>
          <AlertDescription className="text-green-700">{successMsg}</AlertDescription>
        </Alert>
      )}

      {endpoints.length > 0 ? (
        <Card>
          <div className="divide-y">
            {endpoints.map((ep) => (
              <EndpointRow key={ep.id} sourceId={sourceId} endpoint={ep} onDelete={deleteEndpoint} />
            ))}
          </div>
        </Card>
      ) : (
        <p className="py-6 text-center text-sm text-muted-foreground">No endpoints configured.</p>
      )}
    </div>
  );
}

function EndpointRow({
  sourceId,
  endpoint,
  onDelete,
}: {
  sourceId: string;
  endpoint: SourceEndpoint;
  onDelete: ReturnType<typeof useDeleteEndpoint>;
}) {
  const updateEndpoint = useUpdateEndpoint(sourceId);
  const [showEdit, setShowEdit] = useState(false);
  const [editUrl, setEditUrl] = useState(endpoint.endpointUrl);
  const [editParser, setEditParser] = useState(endpoint.parserType);
  const [editStatus, setEditStatus] = useState(endpoint.status);

  const handleSave = async () => {
    await updateEndpoint.mutateAsync({
      endpointId: endpoint.id,
      data: {
        endpointUrl: editUrl,
        parserType: editParser,
        status: editStatus,
      },
    });
    setShowEdit(false);
  };

  return (
    <div className="px-4 py-3">
      {showEdit ? (
        <div className="space-y-2">
          <div className="grid gap-2 sm:grid-cols-3">
            <Input
              value={editUrl}
              onChange={(e) => setEditUrl(e.target.value)}
              className="col-span-2"
            />
            <Input
              value={editParser}
              onChange={(e) => setEditParser(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Select value={editStatus} onValueChange={setEditStatus}>
              <SelectTrigger className="w-[120px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">active</SelectItem>
                <SelectItem value="disabled">disabled</SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" onClick={handleSave} disabled={updateEndpoint.isPending}>
              Save
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowEdit(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm break-all">{endpoint.endpointUrl}</p>
            <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
              <span>parser: {endpoint.parserType}</span>
              {endpoint.contentTypeHint && <span>type: {endpoint.contentTypeHint}</span>}
              {endpoint.scheduleCron && <span>cron: {endpoint.scheduleCron}</span>}
              {endpoint.lastFetchedAt && (
                <span>fetched: {new Date(endpoint.lastFetchedAt).toLocaleString()}</span>
              )}
              <Badge className={endpoint.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}>
                {endpoint.status}
              </Badge>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setShowEdit(true)}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onDelete.mutate(endpoint.id)}
              disabled={onDelete.isPending}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Ingestion Jobs Tab ----

function IngestionJobsTab({ sourceId }: { sourceId: string }) {
  const { data: jobs, isLoading } = useIngestionJobs(sourceId);

  if (isLoading) return <AdminListSkeleton count={3} />;

  if (!jobs || jobs.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">No ingestion jobs found.</p>;
  }

  const statusVariants: Record<string, string> = {
    pending: 'bg-yellow-100 text-yellow-700',
    running: 'bg-blue-100 text-blue-700',
    completed: 'bg-green-100 text-green-700',
    failed: 'bg-red-100 text-red-700',
  };

  return (
    <Card>
      <div className="divide-y">
        {jobs.map((job) => (
          <div key={job.id} className="flex items-center justify-between px-4 py-3">
            <div>
              <p className="text-sm">
                {job.jobType} — {job.source.name}
              </p>
              <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                {job.startedAt && <span>started: {new Date(job.startedAt).toLocaleString()}</span>}
                {job.finishedAt && <span>finished: {new Date(job.finishedAt).toLocaleString()}</span>}
                {job.recordsFound !== null && <span>found: {job.recordsFound}</span>}
                {job.recordsCreated !== null && <span>created: {job.recordsCreated}</span>}
                {job.recordsUpdated !== null && <span>updated: {job.recordsUpdated}</span>}
              </div>
            </div>
            <Badge className={statusVariants[job.status] ?? 'bg-muted text-muted-foreground'}>
              {job.status}
            </Badge>
          </div>
        ))}
      </div>
    </Card>
  );
}
