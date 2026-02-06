import React from 'react';
import { useEngineStore } from '../../store/useEngineStore';
import { EmptyState } from '../display/EmptyState';
import { ProgressStage } from '../display/ProgressStage';
import { ResultViewer } from '../display/ResultViewer';
import { clsx } from 'clsx';

export const MainCanvas: React.FC = () => {
  const { status } = useEngineStore();

  return (
    <main className={clsx(
      "flex-1 bg-page relative overflow-hidden flex flex-col items-center justify-center p-6",
    )}>
      <div className="w-full max-w-5xl h-full flex flex-col justify-center">
        {status === 'idle' && <EmptyState />}
        {status === 'processing' && <ProgressStage />}
        {status === 'success' && <ResultViewer />}
        {status === 'error' && (
           <div className="flex items-center justify-center h-full text-red-500 font-medium bg-red-50/50 rounded-2xl border border-red-100 p-8">
             Something went wrong. Please try again.
           </div>
        )}
      </div>
    </main>
  );
};
