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
          <h2 className="font-serif text-2xl font-bold text-charcoal">Synthesis Complete</h2>
          <p className="text-sm text-charcoal/60">Generated using 1 structure and multiple sources</p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" leftIcon={<ShareNetwork size={18} />}>
            Share
          </Button>
          <Button variant="primary" onClick={handleDownload} leftIcon={<Download size={18} />}>
             Save to Local
          </Button>
        </div>
      </div>

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        className="relative flex-1 bg-white rounded-xl shadow-soft border border-black/5 overflow-hidden group"
      >
        <img 
          src={resultImage} 
          alt="AI Result" 
          className="w-full h-full object-contain bg-checkered" // bg-checkered needs a custom utility or class
        />
        
        {/* Overlay Controls */}
        <div className="absolute bottom-6 right-6 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button variant="secondary" size="sm" className="shadow-lg backdrop-blur-md bg-charcoal/80" leftIcon={<ArrowsOutSimple size={16} />}>
            Fullscreen
          </Button>
        </div>
      </motion.div>
    </div>
  );
};
