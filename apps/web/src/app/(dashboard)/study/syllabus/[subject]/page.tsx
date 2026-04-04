'use client';

import { useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ChevronRight } from 'lucide-react';

import { useSyllabus, useSyllabusProgress, useUpsertSyllabusTopicProgress } from '@/features/study/hooks/use-syllabus';
import type { SyllabusTopic, SyllabusTopicProgress } from '@/features/study/types';
import { ROUTES } from '@/lib/constants';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';

function buildTopicTree(topics: SyllabusTopic[]): SyllabusTopic[] {
  const topLevel = topics.filter((t) => !t.parentTopicId);
  const childMap = new Map<string, SyllabusTopic[]>();

  for (const topic of topics) {
    if (topic.parentTopicId) {
      const siblings = childMap.get(topic.parentTopicId) ?? [];
      siblings.push(topic);
      childMap.set(topic.parentTopicId, siblings);
    }
  }

  return topLevel.map((parent) => ({
    ...parent,
    children: (childMap.get(parent.id) ?? []).sort((a, b) => a.ordering - b.ordering),
  }));
}

interface TopicRowProps {
  topic: SyllabusTopic;
  progress: Record<string, SyllabusTopicProgress>;
  onToggle: (topicId: string, currentStatus: string) => void;
  depth: number;
}

function TopicRow({ topic, progress, onToggle, depth }: TopicRowProps) {
  const topicProgress = progress[topic.id];
  const isCompleted = topicProgress?.status === 'completed';
  const isInProgress = topicProgress?.status === 'in_progress';
  const hasChildren = topic.children && topic.children.length > 0;
  const resourceCount = topic._count?.resources ?? 0;

  // Compute child completion for parent topics
  const childCompletionPct = useMemo(() => {
    if (!hasChildren || !topic.children) return 0;
    const completed = topic.children.filter(
      (c) => progress[c.id]?.status === 'completed',
    ).length;
    return Math.round((completed / topic.children.length) * 100);
  }, [hasChildren, topic.children, progress]);

  if (hasChildren) {
    return (
      <Collapsible defaultOpen>
        <div className="flex items-center gap-2 rounded-md px-2 py-2 hover:bg-muted/50">
          <Checkbox
            checked={isCompleted}
            onCheckedChange={() =>
              onToggle(topic.id, topicProgress?.status ?? 'not_started')
            }
          />
          <CollapsibleTrigger className="flex flex-1 items-center gap-2 text-left">
            <ChevronRight className="h-4 w-4 shrink-0 transition-transform [[data-state=open]>*>&]:rotate-90" />
            <span className={`text-sm font-medium ${isCompleted ? 'line-through text-muted-foreground' : ''}`}>
              {topic.title}
            </span>
          </CollapsibleTrigger>
          <div className="flex items-center gap-2">
            {resourceCount > 0 && (
              <Badge variant="outline" className="text-xs">
                {resourceCount} resource{resourceCount !== 1 ? 's' : ''}
              </Badge>
            )}
            <div className="w-16">
              <Progress value={childCompletionPct} className="h-1.5" />
            </div>
            <span className="w-8 text-right text-xs text-muted-foreground">
              {childCompletionPct}%
            </span>
          </div>
        </div>
        <CollapsibleContent>
          <div className="ml-6 border-l pl-2">
            {topic.children!.map((child) => (
              <TopicRow
                key={child.id}
                topic={child}
                progress={progress}
                onToggle={onToggle}
                depth={depth + 1}
              />
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50">
      <Checkbox
        checked={isCompleted}
        onCheckedChange={() =>
          onToggle(topic.id, topicProgress?.status ?? 'not_started')
        }
      />
      <span
        className={`flex-1 text-sm ${
          isCompleted
            ? 'line-through text-muted-foreground'
            : isInProgress
              ? 'text-blue-700'
              : ''
        }`}
      >
        {topic.title}
      </span>
      {resourceCount > 0 && (
        <Badge variant="outline" className="text-xs">
          {resourceCount}
        </Badge>
      )}
      {isInProgress && (
        <Badge variant="secondary" className="text-xs">
          In Progress
        </Badge>
      )}
    </div>
  );
}

export default function SyllabusSubjectPage() {
  const params = useParams<{ subject: string }>();
  const subject = params.subject;

  const { data: syllabus, isLoading: syllabusLoading } = useSyllabus(subject);
  const { data: progressData, isLoading: progressLoading } = useSyllabusProgress(
    syllabus?.id ?? '',
  );
  const upsertProgress = useUpsertSyllabusTopicProgress();

  const topicTree = useMemo(() => {
    if (!syllabus?.topics) return [];
    return buildTopicTree(syllabus.topics);
  }, [syllabus?.topics]);

  const topicProgress = progressData?.topicProgress ?? {};

  const handleToggle = useCallback(
    (topicId: string, currentStatus: string) => {
      const nextStatus = currentStatus === 'completed' ? 'not_started' : 'completed';
      upsertProgress.mutate({
        topicId,
        data: {
          status: nextStatus as 'not_started' | 'completed',
          progressPct: nextStatus === 'completed' ? 100 : 0,
        },
      });
    },
    [upsertProgress],
  );

  if (syllabusLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96" />
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-10 rounded-md" />
          ))}
        </div>
      </div>
    );
  }

  if (!syllabus) {
    return (
      <div className="py-12 text-center text-muted-foreground">
        Syllabus not found for subject &quot;{subject}&quot;
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Link href={ROUTES.STUDY_SYLLABUS} className="hover:text-foreground">
            Syllabus
          </Link>
          <ChevronRight className="h-3 w-3" />
          <span>{syllabus.title}</span>
        </div>
        <h1 className="mt-2 text-2xl font-bold">{syllabus.title}</h1>
        {syllabus.description && (
          <p className="mt-1 text-sm text-muted-foreground">{syllabus.description}</p>
        )}
      </div>

      {/* Progress Summary */}
      <Card>
        <CardContent className="p-5">
          {progressLoading ? (
            <Skeleton className="h-10 w-full" />
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">
                  {progressData?.completedCount ?? 0} of {progressData?.totalTopics ?? syllabus.topicCount} topics completed
                </span>
                <span className="text-lg font-bold">{progressData?.overallPct ?? 0}%</span>
              </div>
              <Progress value={progressData?.overallPct ?? 0} className="h-2.5" />
              <div className="flex gap-4 text-xs text-muted-foreground">
                <span>{progressData?.completedCount ?? 0} completed</span>
                <span>{progressData?.inProgressCount ?? 0} in progress</span>
                <span>{progressData?.notStartedCount ?? (syllabus.topicCount)} not started</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Topic Tree */}
      <Card>
        <CardContent className="p-4">
          {topicTree.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No topics defined for this syllabus yet.
            </p>
          ) : (
            <div className="space-y-1">
              {topicTree.map((topic) => (
                <TopicRow
                  key={topic.id}
                  topic={topic}
                  progress={topicProgress}
                  onToggle={handleToggle}
                  depth={0}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
