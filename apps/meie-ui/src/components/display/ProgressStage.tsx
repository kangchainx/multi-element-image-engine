import React from 'react';
import { motion } from 'framer-motion';
import { useEngineStore } from '../../store/useEngineStore';
import { Brain, Scan, Lightning, CheckCircle } from 'phosphor-react';

export const ProgressStage: React.FC = () => {
  const { progress } = useEngineStore();

  // Determine current stage based on progress
  const getStageInfo = () => {
    if (progress < 30) return { 
      text: "Analyzing Structure...", 
      icon: <Scan size={32} weight="duotone" className="text-terracotta animate-pulse" />,
      subtext: "Mapping reference geometry" 
    };
    if (progress < 70) return { 
      text: "Extracting Features...", 
      icon: <Brain size={32} weight="duotone" className="text-terracotta animate-pulse" />,
      subtext: "Identifying style elements from sources"
    };
    if (progress < 95) return { 
      text: "Latent Decoding...", 
      icon: <Lightning size={32} weight="duotone" className="text-terracotta animate-pulse" />,
      subtext: "Synthesizing final composition"
    };
    return { 
      text: "Finalizing...", 
      icon: <CheckCircle size={32} weight="duotone" className="text-terracotta" />,
      subtext: "Applying post-processing optimization"
    };
  };

  const { text, icon, subtext } = getStageInfo();

  return (
    <div className="flex flex-col items-center justify-center h-full w-full max-w-md mx-auto">
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.5 }}
        className="w-full bg-white p-8 rounded-2xl shadow-soft border border-black/5"
      >
        <div className="flex flex-col items-center text-center space-y-6">
          <div className="w-20 h-20 bg-cream rounded-full flex items-center justify-center shadow-inner-soft">
            {icon}
          </div>

          <div className="space-y-1">
            <h3 className="font-serif text-xl font-bold text-charcoal">{text}</h3>
            <p className="text-sm text-charcoal/60">{subtext}</p>
          </div>

          <div className="w-full space-y-2">
            <div className="h-2 w-full bg-cream rounded-full overflow-hidden">
              <motion.div 
                className="h-full bg-terracotta"
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                transition={{ type: "spring", stiffness: 50, damping: 20 }}
              />
            </div>
            <div className="flex justify-between text-xs font-mono text-terracotta/80">
              <span>{Math.round(progress)}%</span>
              <span>EST: {Math.max(1, Math.ceil((100 - progress) / 10))}s</span>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
};
