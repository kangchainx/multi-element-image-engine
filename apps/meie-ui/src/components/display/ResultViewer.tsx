import React from 'react';
import { motion } from 'framer-motion';
import { Download, ShareNetwork, ArrowsOutSimple } from 'phosphor-react';
import { useEngineStore } from '../../store/useEngineStore';
import { Button } from '../ui/Button';

export const ResultViewer: React.FC = () => {
  const { resultImage } = useEngineStore();

  if (!resultImage) return null;

  const handleDownload = () => {
    const link = document.createElement('a');
    link.href = resultImage;
    link.download = `MEIE-Generate-${Date.now()}.jpg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="flex flex-col h-full w-full max-w-4xl mx-auto p-4 md:p-8 animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="font-display text-2xl font-semibold text-text-primary tracking-tight">Synthesis Complete</h2>
          <p className="text-sm text-text-secondary mt-1">Generated using 1 structure and multiple sources</p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" leftIcon={<ShareNetwork size={16} />} className="shadow-sm bg-white">
            Share
          </Button>
          <Button variant="primary" onClick={handleDownload} leftIcon={<Download size={16} />}>
             Save to Local
          </Button>
        </div>
      </div>

      <motion.div 
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="relative flex-1 bg-white rounded-2xl shadow-apple border border-border-subtle overflow-hidden group"
      >
        <div className="absolute inset-0 bg-checkered opacity-60 pointer-events-none" />
        <img 
          src={resultImage} 
          alt="AI Result" 
          className="relative w-full h-full object-contain z-10" 
        />
        
        {/* Overlay Controls */}
        <div className="absolute bottom-6 right-6 opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-20">
          <Button variant="secondary" size="sm" className="shadow-modal backdrop-blur-xl bg-white/80 border-white/50" leftIcon={<ArrowsOutSimple size={16} />}>
            Fullscreen
          </Button>
        </div>
      </motion.div>
    </div>
  );
};
