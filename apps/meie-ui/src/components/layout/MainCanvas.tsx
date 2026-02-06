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
      "flex-1 bg-ivory relative overflow-hidden flex flex-col",
      // Add a subtle paper texture overlay or pattern if detailed needed
      "before:content-[''] before:absolute before:inset-0 before:opacity-[0.03] before:pointer-events-none",
      "before:bg-[url('https://www.transparenttextures.com/patterns/cream-paper.png')]"
    )}>
      <div className="flex-1 w-full h-full relative overflow-y-auto">
        {status === 'idle' && <EmptyState />}
        {status === 'processing' && <ProgressStage />}
        {status === 'success' && <ResultViewer />}
        {status === 'error' && (
           <div className="flex items-center justify-center h-full text-red-500">
             Something went wrong. Please try again.
           </div>
        )}
      </div>
    </main>
  );
};
