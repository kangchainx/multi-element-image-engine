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
      <div className="flex items-center justify-between px-1">
        <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
          Source Images <span className="text-accent ml-0.5">{sourceImages.length}</span>
        </h3>
      </div>

      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        className="hidden"
        multiple
        accept="image/*"
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
            <span className="text-sm font-medium text-text-primary">Add Sources</span>
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

interface SourceImageCardProps {
  file: File;
  index: number;
  onRemove: () => void;
}

const SourceImageCard: React.FC<SourceImageCardProps> = ({ file, index, onRemove }) => {
  const url = React.useMemo(() => URL.createObjectURL(file), [file]);

  React.useEffect(() => {
    return () => URL.revokeObjectURL(url);
  }, [url]);

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
       
       <img 
          src={url} 
          alt={`Source ${index}`} 
          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" 
       />
    </Card>
  );
};
