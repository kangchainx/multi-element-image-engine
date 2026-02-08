import React from 'react';
import { motion } from 'framer-motion';
import { Brain, Scan, Lightning, CheckCircle } from 'phosphor-react';

export const ProgressStage: React.FC<{ progress: number; state?: string }> = ({ progress, state }) => {
  const pct = Math.max(0, Math.min(100, Math.round(progress)));

  const stage = (() => {
    if (state === 'queued' || pct <= 10) {
      return {
        text: '已进入队列，等待执行',
        icon: <Scan size={28} weight="duotone" className="text-accent animate-pulse" />,
        subtext: '任务将按顺序执行，请稍候…',
      };
    }
    if (pct < 70) {
      return {
        text: '正在生成中',
        icon: <Brain size={28} weight="duotone" className="text-accent animate-pulse" />,
        subtext: '模型推理中，可能需要几十秒到数分钟',
      };
    }
    if (pct < 95) {
      return {
        text: '即将完成',
        icon: <Lightning size={28} weight="duotone" className="text-accent animate-pulse" />,
        subtext: '正在收尾与保存输出',
      };
    }
    return {
      text: '正在收尾',
      icon: <CheckCircle size={28} weight="duotone" className="text-green-500" />,
      subtext: '马上就好',
    };
  })();

  return (
    <div className="flex flex-col items-center justify-center h-full w-full max-w-sm mx-auto">
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.4 }}
        className="w-full bg-white p-6 rounded-2xl shadow-modal border border-border-subtle/50"
      >
        <div className="flex flex-col items-center text-center space-y-5">
          <div className="w-16 h-16 bg-sidebar rounded-2xl flex items-center justify-center border border-border-subtle">
            {stage.icon}
          </div>

          <div className="space-y-1">
            <h3 className="font-display text-lg font-medium text-text-primary">{stage.text}</h3>
            <p className="text-xs text-text-secondary">{stage.subtext}</p>
          </div>

          <div className="w-full space-y-2 pt-2">
            <div className="h-1.5 w-full bg-sidebar rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-accent"
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ type: 'spring', stiffness: 50, damping: 20 }}
              />
            </div>
            <div className="flex justify-between text-[10px] font-mono text-text-secondary">
              <span className="text-accent font-medium">{pct}%</span>
              <span>状态: {state || 'running'}</span>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
};
