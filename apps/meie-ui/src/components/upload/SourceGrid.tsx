import React, { useRef, useState } from 'react';
import { useEngineStore } from '../../store/useEngineStore';
import { Plus, X } from 'phosphor-react';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';

export const SourceGrid: React.FC = () => {
  const { sourceImages, addSourceImages, removeSourceImage } = useEngineStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [lastAddError, setLastAddError] = useState<string | null>(null);

  const isSupportedImage = (f: File): boolean => {
    const t = (f.type || '').toLowerCase();
    if (t === 'image/png' || t === 'image/jpeg' || t === 'image/webp') return true;
    // Some browsers provide empty type; fall back to extension.
    const name = (f.name || '').toLowerCase();
    return name.endsWith('.png') || name.endsWith('.jpg') || name.endsWith('.jpeg') || name.endsWith('.webp');
  };

  const splitSupported = (files: File[]) => {
    const ok: File[] = [];
    const bad: File[] = [];
    for (const f of files) (isSupportedImage(f) ? ok : bad).push(f);
    return { ok, bad };
  };

  /**
   * 处理多个文件选择
   */
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const { ok, bad } = splitSupported(Array.from(e.target.files));
      if (bad.length > 0) {
        setLastAddError(`不支持的图片格式：${bad.map((x) => x.name).join('，')}。请使用 PNG/JPG/WebP。`);
      } else {
        setLastAddError(null);
      }
      if (ok.length > 0) addSourceImages(ok);
      e.target.value = '';
    }
  };

  /**
   * 处理拖拽进入
   */
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  /**
   * 处理拖拽离开
   */
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  /**
   * 处理多个文件放下
   */
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const { ok, bad } = splitSupported(Array.from(e.dataTransfer.files));
      if (bad.length > 0) {
        setLastAddError(`不支持的图片格式：${bad.map((x) => x.name).join('，')}。请使用 PNG/JPG/WebP。`);
      } else {
        setLastAddError(null);
      }
      if (ok.length > 0) addSourceImages(ok);
    }
  };

  return (
    <div className="w-full space-y-3 flex-1 overflow-hidden flex flex-col">
      <div className="flex items-center justify-between px-1">
        <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
          素材图 <span className="text-accent ml-0.5">{sourceImages.length}</span>
        </h3>
      </div>
      {lastAddError && (
        <div className="px-1 text-[11px] text-red-600 leading-snug">{lastAddError}</div>
      )}

      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        className="hidden"
        multiple
        accept="image/png,image/jpeg,image/webp"
      />

      <div className="flex-1 overflow-y-auto pr-1 -mr-2 space-y-3 pb-4 custom-scrollbar">
        {/* Empty Upload Zone / Add Button */}
        <div
          onClick={() => fileInputRef.current?.click()}
          onDragEnter={handleDragEnter}
          onDragOver={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`
            relative w-full border-[1.5px] border-dashed rounded-xl flex flex-col items-center justify-center
            transition-all duration-300 cursor-pointer group bg-white/40 min-h-[100px]
            ${isDragOver 
              ? 'border-accent bg-accent/5' 
              : 'border-border-strong hover:border-accent/50 hover:bg-white'}
          `}
        >
          <div className="flex items-center gap-2">
            <div className={`p-1.5 rounded-full bg-sidebar transition-colors duration-200 ${isDragOver ? 'bg-accent/20' : 'group-hover:bg-accent/10'}`}>
               <Plus size={16} className="text-accent" weight="bold" />
            </div>
            <span className="text-sm font-medium text-text-primary">添加素材图</span>
          </div>
        </div>

        {/* Grid of Images */}
        <div className="grid grid-cols-2 gap-3">
          {sourceImages.map((file, index) => (
            <SourceImageCard 
              key={`${file.name}-${file.size}-${file.lastModified}-${index}`}
              file={file} 
              index={index} 
              onRemove={() => removeSourceImage(index)}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

interface SourceImageCardProps {
  file: File;
  index: number;
  onRemove: () => void;
}

const SourceImageCard: React.FC<SourceImageCardProps> = ({ file, index, onRemove }) => {
  const [url, setUrl] = React.useState<string>('');
  const [broken, setBroken] = React.useState(false);

  // IMPORTANT: Create object URLs in effects, not during render.
  // In React 18 dev StrictMode, render can be invoked multiple times; creating/revoking
  // blob URLs during render can lead to ERR_FILE_NOT_FOUND.
  React.useEffect(() => {
    setBroken(false);
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => {
      try {
        URL.revokeObjectURL(u);
      } catch {
        // ignore
      }
    };
  }, [file]);

  return (
    <Card className="relative aspect-square group animate-fade-in shadow-sm border border-border-subtle hover:shadow-md">
       <div className="absolute top-1 left-1 bg-white/90 text-text-primary text-[9px] px-1.5 py-0.5 rounded font-medium backdrop-blur-md z-10 shadow-sm">
          #{index + 1}
       </div>
       <Button 
          variant="secondary" 
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="absolute top-1 right-1 w-5 h-5 min-w-0 p-0 rounded-full bg-white/90 text-text-primary hover:bg-red-500 hover:text-white opacity-0 group-hover:opacity-100 transition-all shadow-sm z-10"
       >
         <X size={12} weight="bold" />
       </Button>
       
       {!broken && url ? (
         <img
           src={url}
           alt={`素材图 ${index + 1}`}
           onError={() => setBroken(true)}
           className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
         />
       ) : (
         <div className="w-full h-full flex flex-col items-center justify-center bg-sidebar text-text-secondary px-2 text-center">
           <div className="text-xs font-medium">无法预览</div>
           <div className="text-[10px] mt-1 break-all">{file.name}</div>
         </div>
       )}
    </Card>
  );
};
