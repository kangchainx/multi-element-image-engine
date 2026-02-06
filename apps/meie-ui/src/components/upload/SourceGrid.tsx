import React, { useRef, useState } from 'react';
import { useEngineStore } from '../../store/useEngineStore';
import { Plus, X } from 'phosphor-react';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';

export const SourceGrid: React.FC = () => {
  const { sourceImages, addSourceImages, removeSourceImage } = useEngineStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  /**
   * 处理多个文件选择
   */
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      addSourceImages(Array.from(e.target.files));
      // 重置input，允许重复选择相同文件
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
      addSourceImages(Array.from(e.dataTransfer.files));
    }
  };

  return (
    <div className="w-full space-y-3 flex-1 overflow-hidden flex flex-col">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-charcoal uppercase tracking-wider opacity-80 pl-1">
          Source Images <span className="text-terracotta ml-1">{sourceImages.length}</span>
        </h3>
        
        {sourceImages.length > 0 && (
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => useEngineStore.getState().addSourceImages([])} // 这里可以加一个清空所有的方法，但 store 没定义，先不加
            className="text-xs text-charcoal/50 hover:text-red-500 hidden"
          >
            Clear All
          </Button>
        )}
      </div>

      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        className="hidden"
        multiple
        accept="image/*"
      />

      <div className="flex-1 overflow-y-auto pr-2 -mr-2 space-y-3 pb-4 custom-scrollbar">
        {/* Empty Upload Zone / Add Button */}
        <div
          onClick={() => fileInputRef.current?.click()}
          onDragEnter={handleDragEnter}
          onDragOver={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`
            relative w-full border-[1.5px] border-dashed rounded-xl flex flex-col items-center justify-center
            transition-all duration-300 cursor-pointer group bg-white/50 min-h-[120px]
            ${isDragOver 
              ? 'border-terracotta bg-terracotta/5' 
              : 'border-black/10 hover:border-terracotta/50 hover:bg-white'}
          `}
        >
          <div className="flex items-center gap-2">
            <div className={`p-2 rounded-full bg-cream transition-colors duration-200 ${isDragOver ? 'bg-terracotta/20' : 'group-hover:bg-terracotta/10'}`}>
               <Plus size={20} className="text-terracotta" weight="bold" />
            </div>
            <span className="text-sm font-medium text-charcoal/80">Add Sources</span>
          </div>
        </div>

        {/* Grid of Images */}
        <div className="grid grid-cols-2 gap-3">
          {sourceImages.map((file, index) => (
            <SourceImageCard 
              key={`${file.name}-${index}`} 
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

// Sub-component specifically for items to avoid large file size
interface SourceImageCardProps {
  file: File;
  index: number;
  onRemove: () => void;
}

const SourceImageCard: React.FC<SourceImageCardProps> = ({ file, index, onRemove }) => {
  const url = React.useMemo(() => URL.createObjectURL(file), [file]);

  // Clean up object URL on unmount
  React.useEffect(() => {
    return () => URL.revokeObjectURL(url);
  }, [url]);

  return (
    <Card className="relative aspect-square group animate-fade-in">
       <div className="absolute top-1 left-1 bg-black/50 text-white text-[9px] px-1.5 py-0.5 rounded font-mono backdrop-blur-sm z-10">
          #{index + 1}
       </div>
       <Button 
          variant="secondary" 
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="absolute top-1 right-1 w-5 h-5 min-w-0 p-0 rounded-full bg-white/90 text-charcoal hover:bg-red-500 hover:text-white opacity-0 group-hover:opacity-100 transition-all shadow-sm z-10"
       >
         <X size={12} weight="bold" />
       </Button>
       
       <img 
          src={url} 
          alt={`Source ${index}`} 
          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" 
       />
    </Card>
  );
};
