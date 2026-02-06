import React, { useRef, useState } from 'react';
import { useEngineStore } from '../../store/useEngineStore';
import { X, Image as ImageIcon } from 'phosphor-react';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';

export const RefUpload: React.FC = () => {
  const { referenceImage, setRefImage } = useEngineStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  /**
   * 处理文件选择 - 从输入框点击
   */
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setRefImage(e.target.files[0]);
    }
  };

  /**
   * 处理拖拽进入区域
   */
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  /**
   * 处理拖拽离开区域
   */
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  /**
   * 处理文件放下
   */
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setRefImage(e.dataTransfer.files[0]);
    }
  };

  /**
   * 移除参考图
   */
  const handleRemove = () => {
    setRefImage(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  /**
   * 获取当前预览图的 URL
   */
  const getPreviewUrl = () => {
    if (!referenceImage) return '';
    if (typeof referenceImage === 'string') return referenceImage;
    return URL.createObjectURL(referenceImage);
  };
  
  const previewUrl = getPreviewUrl();

  return (
    <div className="w-full space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-charcoal uppercase tracking-wider opacity-80 pl-1">
          Reference (Structure)
        </h3>
        {referenceImage && (
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={handleRemove}
            className="h-6 w-6 p-0 text-red-500 hover:text-red-700 hover:bg-red-50"
          >
            <X size={14} weight="bold" />
          </Button>
        )}
      </div>

      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        className="hidden"
        accept="image/*"
      />

      {referenceImage ? (
        <Card className="relative aspect-[4/3] group cursor-pointer border-terracotta/20 border-2">
          <img 
            src={previewUrl} 
            alt="Reference" 
            className="w-full h-full object-cover" 
          />
          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
             <Button variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()}>
                Change
             </Button>
          </div>
          <div className="absolute top-2 left-2 bg-terracotta/90 text-white text-[10px] px-2 py-0.5 rounded-full font-bold shadow-sm backdrop-blur-sm">
            STRUCTURE
          </div>
        </Card>
      ) : (
        <div
          onClick={() => fileInputRef.current?.click()}
          onDragEnter={handleDragEnter}
          onDragOver={handleDragEnter} // DragOver 必须阻止默认行为
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`
            relative aspect-[4/3] border-[1.5px] border-dashed rounded-xl flex flex-col items-center justify-center
            transition-all duration-300 cursor-pointer group bg-white/50
            ${isDragOver 
              ? 'border-terracotta bg-terracotta/5 scale-[1.02]' 
              : 'border-black/10 hover:border-terracotta/50 hover:bg-white'}
          `}
        >
          <div className={`p-4 rounded-full bg-cream mb-3 transition-transform duration-300 ${isDragOver ? 'scale-110' : 'group-hover:scale-110'}`}>
            <ImageIcon size={28} className="text-terracotta/80" weight="duotone" />
          </div>
          <span className="text-sm font-medium text-charcoal/80">Upload Reference</span>
          <span className="text-xs text-charcoal/40 mt-1">Drag & drop or Click</span>
        </div>
      )}
    </div>
  );
};
