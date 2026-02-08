import React from 'react';
import { Aperture } from 'phosphor-react';

export const EmptyState: React.FC = () => {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center animate-fade-in">
      <div className="w-20 h-20 rounded-2xl bg-sidebar flex items-center justify-center mb-6 shadow-sm border border-border-subtle">
        <Aperture size={40} weight="light" className="text-text-secondary" />
      </div>
      <h3 className="font-display text-xl font-medium text-text-primary mb-2">等待创建任务</h3>
      <p className="max-w-xs leading-relaxed text-text-secondary text-sm">
        左侧上传参考图与素材图后，点击“创建任务”加入队列。运行中的任务与历史记录请在右侧查看。
      </p>
    </div>
  );
};
