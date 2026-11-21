'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ActionLog } from '@/features/moderation/components/action-log';
import { CaseQueue } from '@/features/moderation/components/case-queue';
import { ModerationStatCards } from '@/features/moderation/components/moderation-stat-cards';
import { SanctionsList } from '@/features/moderation/components/sanctions-list';

export default function ModerationQueuePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Moderation</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          User reports on feed posts, comments and community study items. Every report gets a
          review within 24 hours of the first report.
        </p>
      </div>

      <ModerationStatCards />

      <Tabs defaultValue="queue">
        <TabsList>
          <TabsTrigger value="queue">Queue</TabsTrigger>
          <TabsTrigger value="sanctions">Sanctions</TabsTrigger>
          <TabsTrigger value="log">Log</TabsTrigger>
        </TabsList>
        <TabsContent value="queue" className="mt-4">
          <CaseQueue />
        </TabsContent>
        <TabsContent value="sanctions" className="mt-4">
          <SanctionsList />
        </TabsContent>
        <TabsContent value="log" className="mt-4">
          <ActionLog />
        </TabsContent>
      </Tabs>
    </div>
  );
}
