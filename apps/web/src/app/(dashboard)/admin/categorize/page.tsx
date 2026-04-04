'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Play } from 'lucide-react';
import { apiClient, ApiClientError } from '@/lib/api-client';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface CategorizationResult {
  processed: number;
  tagged: number;
  skipped: number;
  tagCounts: Record<string, number>;
}

export default function CategorizeBarSubjectsPage() {
  const [batchSize, setBatchSize] = useState(500);
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<CategorizationResult | null>(null);
  const [error, setError] = useState('');
  const [totalRuns, setTotalRuns] = useState(0);

  const handleRun = async () => {
    setIsRunning(true);
    setError('');
    try {
      const response = await apiClient.post<{ success: boolean; data: CategorizationResult }>(
        '/admin/categorize-bar-subjects',
        { batchSize },
      );
      setResult(response.data);
      setTotalRuns((prev) => prev + 1);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message);
      } else {
        setError('Failed to run categorization');
      }
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <Button variant="link" size="sm" className="px-0 text-muted-foreground" asChild>
          <Link href="/admin">
            <ArrowLeft className="mr-1 h-3.5 w-3.5" />
            Admin Dashboard
          </Link>
        </Button>
        <h1 className="mt-2 text-2xl font-bold">Bar Subject Categorization</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Assign bar subject tags to published documents using keyword-based rules.
          Documents already tagged are skipped.
        </p>
      </div>

      {/* Controls */}
      <Card>
        <CardContent className="flex items-end gap-4 p-4">
          <div>
            <Label htmlFor="batch-size">Batch size</Label>
            <Input
              id="batch-size"
              type="number"
              min={1}
              max={2000}
              value={batchSize}
              onChange={(e) => setBatchSize(Number(e.target.value))}
              className="mt-1 w-28"
            />
          </div>
          <Button
            onClick={handleRun}
            disabled={isRunning}
          >
            <Play className="mr-1.5 h-3.5 w-3.5" />
            {isRunning ? 'Running...' : 'Run Categorization'}
          </Button>
          {totalRuns > 0 && (
            <span className="text-xs text-muted-foreground">{totalRuns} run(s) this session</span>
          )}
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Results */}
      {result && (
        <Card>
          <CardContent className="space-y-4 p-4">
            <h2 className="text-sm font-semibold">Results</h2>

            <div className="grid gap-4 sm:grid-cols-3">
              <Card>
                <CardContent className="p-3">
                  <p className="text-xs text-muted-foreground">Processed</p>
                  <p className="mt-1 text-xl font-bold">{result.processed}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3">
                  <p className="text-xs text-muted-foreground">Tagged</p>
                  <p className="mt-1 text-xl font-bold text-green-600">{result.tagged}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3">
                  <p className="text-xs text-muted-foreground">Skipped (no match)</p>
                  <p className="mt-1 text-xl font-bold text-muted-foreground">{result.skipped}</p>
                </CardContent>
              </Card>
            </div>

            {Object.keys(result.tagCounts).length > 0 && (
              <div>
                <h3 className="mb-2 text-xs font-medium text-muted-foreground">Tags Applied</h3>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(result.tagCounts)
                    .sort(([, a], [, b]) => b - a)
                    .map(([code, count]) => (
                      <Badge
                        key={code}
                        className="bg-blue-50 text-blue-700"
                      >
                        {code.replace(/_/g, ' ')}
                        <span className="ml-1 rounded-full bg-blue-200 px-1.5 py-0.5 text-[10px] font-bold">
                          {count}
                        </span>
                      </Badge>
                    ))}
                </div>
              </div>
            )}

            {result.processed === 0 && (
              <p className="text-sm text-muted-foreground">
                All published documents are already categorized, or there are no published documents.
              </p>
            )}

            {result.processed > 0 && result.processed >= batchSize && (
              <p className="text-sm text-yellow-600">
                Batch limit reached. There may be more documents to categorize. Run again to process the next batch.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Info */}
      <Card className="bg-muted">
        <CardContent className="p-4">
          <h3 className="text-sm font-semibold">How it works</h3>
          <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
            <li>Finds published documents with no bar subject tags</li>
            <li>Matches document title, citation, and agency against keyword rules</li>
            <li>Assigns one or more bar subject tags (Civil, Criminal, Commercial, etc.)</li>
            <li>Documents with no keyword matches are skipped</li>
            <li>Run multiple times to process all documents in batches</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
