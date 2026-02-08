import React from 'react';
import { clsx } from 'clsx';
import { useEngineStore } from '../../store/useEngineStore';
import { EmptyState } from '../display/EmptyState';
import { ProgressStage } from '../display/ProgressStage';
import { ResultViewer } from '../display/ResultViewer';

export const MainCanvas: React.FC = () => {
  const { jobs, selectedJobId } = useEngineStore();

  const job = React.useMemo(() => {
    if (!selectedJobId) return null;
    return jobs.find((j) => j.id === selectedJobId) || null;
  }, [jobs, selectedJobId]);

  return (
    <main className={clsx('flex-1 bg-page relative overflow-hidden flex flex-col items-center justify-center p-6')}>
      <div className="w-full max-w-5xl h-full flex flex-col justify-center">
        {!job ? (
          <EmptyState />
        ) : job.state === 'completed' && job.resultImage ? (
          <ResultViewer imageUrl={job.resultImage} />
        ) : job.state === 'failed' || job.state === 'canceled' ? (
          <div className="flex flex-col items-center justify-center h-full bg-white rounded-2xl border border-border-subtle p-8 shadow-apple">
            <div className="text-sm font-semibold text-text-primary">任务已结束</div>
            <div className="mt-2 text-xs text-text-secondary">状态: {job.state}</div>
            {job.error ? <div className="mt-3 text-sm text-red-600 max-w-xl text-center">{job.error}</div> : null}
          </div>
        ) : (
          <ProgressStage progress={job.progressPct || 0} state={job.state} />
        )}
      </div>
    </main>
  );
};
