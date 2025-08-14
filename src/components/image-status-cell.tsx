"use client"

import { useScanning } from '@/providers/ScanningProvider';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { IconCircleCheckFilled, IconLoader } from '@tabler/icons-react';

interface ImageStatusCellProps {
  imageName: string;
  imageId?: string;
  status: string;
}

export function ImageStatusCell({ imageName, imageId, status }: ImageStatusCellProps) {
  const { runningJobs } = useScanning();
  
  // Check if there's a running scan for this image (by name or imageId)
  const runningJob = runningJobs.find(job => 
    job.imageId === imageId || 
    job.imageId === imageName ||
    // Also check if the job's imageId matches the displayed image name
    imageName.includes(job.imageId) ||
    job.imageId.includes(imageName)
  );

  // If there's a running scan, show progress bar instead of status badge
  if (runningJob) {
    return (
      <div className="w-32 space-y-1">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Scanning</span>
          <span className="font-mono">{runningJob.progress}%</span>
        </div>
        <Progress 
          value={runningJob.progress} 
          className="h-2"
        />
        {runningJob.step && (
          <div className="text-xs text-muted-foreground truncate">
            {runningJob.step}
          </div>
        )}
      </div>
    );
  }

  // Otherwise show the regular status badge
  return (
    <Badge variant="outline" className="text-muted-foreground px-1.5">
      {status === "Complete" ? (
        <IconCircleCheckFilled className="fill-green-500 dark:fill-green-400" />
      ) : (
        <IconLoader />
      )}
      {status}
    </Badge>
  );
}