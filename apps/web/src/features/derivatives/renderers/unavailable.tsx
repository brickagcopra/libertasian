import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircleIcon } from 'lucide-react';

export function Unavailable({
  message = 'Content unavailable — please regenerate.',
}: {
  message?: string;
}) {
  return (
    <Alert>
      <AlertCircleIcon className="h-4 w-4" />
      <AlertDescription className="text-sm">{message}</AlertDescription>
    </Alert>
  );
}
