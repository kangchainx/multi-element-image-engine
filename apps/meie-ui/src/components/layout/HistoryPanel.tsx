import React from 'react';
import { clsx } from 'clsx';
import { ClockCounterClockwise, Hourglass, CheckCircle, XCircle, Prohibit } from 'phosphor-react';
import { useEngineStore } from '../../store/useEngineStore';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';

type TabKey = 'active' | 'done';

function isActiveState(state: string): boolean {
  return state === 'creating' || state === 'queued' || state === 'running';
}

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

function fmtTime(v: any): string {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) return '';
  try {
    return new Date(n).toLocaleString('zh-CN');
  } catch {
    return String(n);
  }
}

export const HistoryPanel: React.FC = () => {
  const { jobs, selectedJobId, selectJob, loadHistory, cancelJob, uiError } = useEngineStore();
  const [tab, setTab] = React.useState<TabKey>('active');

  React.useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const activeJobs = React.useMemo(() => {
    return jobs
      .filter((j) => isActiveState(j.state))
      .slice()
      .sort((a, b) => {
        const ta = typeof a.created_at === 'number' ? a.created_at : 0;
        const tb = typeof b.created_at === 'number' ? b.created_at : 0;
        return ta - tb; // oldest first
      });
  }, [jobs]);

  const doneJobs = React.useMemo(() => {
    return jobs
      .filter((j) => !isActiveState(j.state))
      .slice()
      .sort((a, b) => {
        const ta = typeof a.created_at === 'number' ? a.created_at : 0;
        const tb = typeof b.created_at === 'number' ? b.created_at : 0;
        return tb - ta; // newest first
      });
  }, [jobs]);

  const list = tab === 'active' ? activeJobs : doneJobs;

  return (
    <aside className="w-[340px] bg-sidebar border-l border-border-subtle flex flex-col h-[calc(100vh-56px)] overflow-hidden">
      <div className="p-4 flex-none border-b border-border-subtle">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ClockCounterClockwise size={18} className="text-text-secondary" />
            <h3 className="text-sm font-semibold text-text-primary">历史记录</h3>
          </div>
        </div>

        <div className="mt-3 flex gap-2">
          <button
            className={clsx(
              'flex-1 px-3 py-2 rounded-lg text-xs font-medium border transition-colors',
              tab === 'active'
                ? 'bg-white border-border-subtle text-text-primary'
                : 'bg-transparent border-transparent text-text-secondary hover:bg-white/40',
            )}
            onClick={() => setTab('active')}
            type="button"
          >
            进行中 ({activeJobs.length})
          </button>
          <button
            className={clsx(
              'flex-1 px-3 py-2 rounded-lg text-xs font-medium border transition-colors',
              tab === 'done'
                ? 'bg-white border-border-subtle text-text-primary'
                : 'bg-transparent border-transparent text-text-secondary hover:bg-white/40',
            )}
            onClick={() => setTab('done')}
            type="button"
          >
            历史 ({doneJobs.length})
          </button>
        </div>

        {uiError ? <div className="mt-2 text-[11px] text-red-600">{uiError}</div> : null}
      </div>

      <div className="p-4 flex-1 overflow-y-auto custom-scrollbar space-y-3">
        {list.length === 0 ? (
          <div className="text-xs text-text-secondary leading-relaxed">
            {tab === 'active' ? '暂无进行中的任务。' : '暂无历史记录。'}
          </div>
        ) : null}

        {list.map((j) => {
          const selected = j.id === selectedJobId;
          const title = j.state === 'completed' ? '已完成' : j.state === 'failed' ? '失败' : j.state === 'canceled' ? '已取消' : '进行中';
          const Icon = j.state === 'completed' ? CheckCircle : j.state === 'failed' ? XCircle : j.state === 'canceled' ? Prohibit : Hourglass;

          return (
            <Card
              key={j.id}
              onClick={() => selectJob(j.id)}
              className={clsx(
                'p-3 cursor-pointer',
                selected ? 'ring-2 ring-accent/40 border-accent/30' : 'hover:border-border-strong',
              )}
            >
              <div className="flex gap-3">
                <div className="w-14 h-14 rounded-lg bg-white border border-border-subtle overflow-hidden flex items-center justify-center">
                  {j.resultImage ? (
                    <img src={j.resultImage} alt="结果缩略图" className="w-full h-full object-cover" />
                  ) : (
                    <Icon size={22} className="text-text-secondary" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-semibold text-text-primary truncate">任务 {shortId(j.id)}</div>
                    <div className="text-[11px] text-text-secondary whitespace-nowrap">{title}</div>
                  </div>

                  <div className="mt-1 text-[11px] text-text-secondary truncate">{fmtTime(j.created_at)}</div>

                  {isActiveState(j.state) ? (
                    <div className="mt-2">
                      <div className="h-1.5 w-full bg-sidebar rounded-full overflow-hidden">
                        <div className="h-full bg-accent" style={{ width: `${Math.max(0, Math.min(100, j.progressPct || 0))}%` }} />
                      </div>
                      <div className="mt-1 flex items-center justify-between text-[10px] font-mono text-text-secondary">
                        <span>{Math.round(j.progressPct || 0)}%</span>
                        <span>{j.state}</span>
                      </div>
                    </div>
                  ) : null}

                  {j.state === 'failed' && j.error ? (
                    <div className="mt-2 text-[11px] text-red-600 line-clamp-2">{j.error}</div>
                  ) : null}

                  {isActiveState(j.state) ? (
                    <div className="mt-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="px-2"
                        onClick={(e) => {
                          e.stopPropagation();
                          void cancelJob(j.id);
                        }}
                      >
                        取消
                      </Button>
                    </div>
                  ) : null}
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </aside>
  );
};
