import React from 'react';
import { RefUpload } from '../upload/RefUpload';
import { SourceGrid } from '../upload/SourceGrid';
import { useEngineStore } from '../../store/useEngineStore';
import { Button } from '../ui/Button';
import { MagicWand, Trash } from 'phosphor-react';

function isActiveState(state: string): boolean {
  return state === 'creating' || state === 'queued' || state === 'running';
}

export const Sidebar: React.FC = () => {
  const { enqueueJob, referenceImage, sourceImages, status, resetDraft, jobs, uiError } = useEngineStore();

  const activeCount = jobs.filter((j) => isActiveState(j.state)).length;
  const canGenerate = Boolean(referenceImage) && sourceImages.length > 0;
  const isEnqueueing = status === 'enqueueing';
  const disabledByLimit = activeCount >= 3;

  return (
    <aside className="w-[300px] bg-sidebar border-r border-border-subtle flex flex-col h-[calc(100vh-56px)] overflow-hidden">
      <div className="p-4 flex-1 flex flex-col gap-6 overflow-hidden">
        <section className="flex-none">
          <RefUpload />
        </section>

        <section className="flex-1 flex flex-col min-h-0">
          <SourceGrid />
        </section>

        <section className="flex-none pt-4 space-y-3 border-t border-border-subtle">
          <div className="flex items-center justify-between text-[11px] text-text-secondary px-1">
            <span>进行中任务</span>
            <span className={disabledByLimit ? 'text-red-600 font-medium' : ''}>{activeCount}/3</span>
          </div>

          <Button
            variant="primary"
            size="lg"
            className="w-full text-[15px] font-medium shadow-sm transition-all"
            disabled={!canGenerate || isEnqueueing || disabledByLimit}
            isLoading={isEnqueueing}
            onClick={() => void enqueueJob()}
            leftIcon={<MagicWand size={18} weight="fill" />}
          >
            {isEnqueueing ? '正在创建…' : disabledByLimit ? '队列已满(最多3个)' : '创建任务'}
          </Button>

          {(referenceImage || sourceImages.length > 0) && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-text-secondary hover:text-red-600"
              onClick={resetDraft}
              disabled={isEnqueueing}
              leftIcon={<Trash size={16} />}
            >
              清空输入
            </Button>
          )}

          {uiError ? <div className="text-[11px] text-red-600 leading-snug px-1">{uiError}</div> : null}
        </section>
      </div>
    </aside>
  );
};
