import React from 'react';
import { motion } from 'framer-motion';
import { useEngineStore } from '../../store/useEngineStore';
import { Brain, Scan, Lightning, CheckCircle } from 'phosphor-react';

export const ProgressStage: React.FC = () => {
  const { progress } = useEngineStore();

  const getStageInfo = () => {
    if (progress < 30) return { 
      text: "Analyzing Structure...", 
      icon: <Scan size={28} weight="duotone" className="text-accent animate-pulse" />,
      subtext: "Mapping reference geometry" 
    };
    if (progress < 70) return { 
      text: "Extracting Features...", 
      icon: <Brain size={28} weight="duotone" className="text-accent animate-pulse" />,
      subtext: "Identifying style elements from sources"
    };
    if (progress < 95) return { 
      text: "Latent Decoding...", 
      icon: <Lightning size={28} weight="duotone" className="text-accent animate-pulse" />,
      subtext: "Synthesizing final composition"
    };
    return { 
      text: "Finalizing...", 
      icon: <CheckCircle size={28} weight="duotone" className="text-green-500" />,
      subtext: "Applying post-processing optimization"
    };
  };

  const { text, icon, subtext } = getStageInfo();

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
            {icon}
          </div>

          <div className="space-y-1">
            <h3 className="font-display text-lg font-medium text-text-primary">{text}</h3>
            <p className="text-xs text-text-secondary">{subtext}</p>
          </div>

          <div className="w-full space-y-2 pt-2">
            <div className="h-1.5 w-full bg-sidebar rounded-full overflow-hidden">
              <motion.div 
                className="h-full bg-accent"
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                transition={{ type: "spring", stiffness: 50, damping: 20 }}
              />
            </div>
            <div className="flex justify-between text-[10px] font-mono text-text-secondary">
              <span className="text-accent font-medium">{Math.round(progress)}%</span>
              <span>EST: {Math.max(1, Math.ceil((100 - progress) / 10))}s</span>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
};
