import React from 'react';
import { motion } from 'framer-motion';
import { Download, ArrowsOutSimple } from 'phosphor-react';
import { Button } from '../ui/Button';

export const ResultViewer: React.FC<{ imageUrl: string }> = ({ imageUrl }) => {
  const handleDownload = () => {
    const link = document.createElement('a');
    link.href = imageUrl;
    link.download = `MEIE-结果-${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleOpen = () => {
    try {
      window.open(imageUrl, '_blank', 'noopener,noreferrer');
    } catch {
      // ignore
    }
  };

  return (
    <div className="flex flex-col h-full w-full max-w-4xl mx-auto p-4 md:p-8 animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="font-display text-2xl font-semibold text-text-primary tracking-tight">生成结果</h2>
          <p className="text-sm text-text-secondary mt-1">右键或点击按钮可下载图片</p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" onClick={handleOpen} leftIcon={<ArrowsOutSimple size={16} />} className="shadow-sm bg-white">
            打开原图
          </Button>
          <Button variant="primary" onClick={handleDownload} leftIcon={<Download size={16} />}>
            下载
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
        <img src={imageUrl} alt="生成结果" className="relative w-full h-full object-contain z-10" />
      </motion.div>
    </div>
  );
};
