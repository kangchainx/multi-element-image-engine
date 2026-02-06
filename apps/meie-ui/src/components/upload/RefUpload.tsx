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
      <div className="flex items-center justify-between px-1">
        <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
          Reference (Structure)
        </h3>
        {referenceImage && (
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={handleRemove}
            className="h-6 w-6 p-0 text-text-secondary hover:text-red-500 hover:bg-red-50"
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
        <Card className="relative aspect-[4/3] group cursor-pointer border-accent/20 border-2 shadow-sm">
          <img 
            src={previewUrl} 
            alt="Reference" 
            className="w-full h-full object-cover" 
          />
          <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-[2px]">
             <Button variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()} className="shadow-lg">
                Change
             </Button>
          </div>
          <div className="absolute top-2 left-2 bg-white/90 text-text-primary text-[10px] px-2 py-0.5 rounded-md font-medium shadow-sm backdrop-blur-md">
            STRUCTURE
          </div>
        </Card>
      ) : (
        <div
          onClick={() => fileInputRef.current?.click()}
          onDragEnter={handleDragEnter}
          onDragOver={handleDragEnter} 
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`
            relative aspect-[4/3] border-[1.5px] border-dashed rounded-xl flex flex-col items-center justify-center
            transition-all duration-300 cursor-pointer group bg-white/40
            ${isDragOver 
              ? 'border-accent bg-accent/5 scale-[1.01]' 
              : 'border-border-strong hover:border-accent/50 hover:bg-white'}
          `}
        >
          <div className={`p-3 rounded-full bg-sidebar mb-2 transition-transform duration-300 shadow-sm ${isDragOver ? 'scale-110' : 'group-hover:scale-110'}`}>
            <ImageIcon size={24} className="text-text-secondary" weight="duotone" />
          </div>
          <span className="text-sm font-medium text-text-primary">Upload Reference</span>
          <span className="text-xs text-text-secondary mt-1">Drag & drop or Click</span>
        </div>
      )}
    </div>
  );
};
