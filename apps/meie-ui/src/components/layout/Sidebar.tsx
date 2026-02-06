import React from 'react';
import { RefUpload } from '../upload/RefUpload';
import { SourceGrid } from '../upload/SourceGrid';
import { useEngineStore } from '../../store/useEngineStore';
import { Button } from '../ui/Button';
import { MagicWand, Trash } from 'phosphor-react';

export const Sidebar: React.FC = () => {
  const { startGeneration, referenceImage, sourceImages, status, reset } = useEngineStore();
  
  const canGenerate = referenceImage && sourceImages.length > 0;
  const isProcessing = status === 'processing';

  return (
    <aside className="w-[320px] bg-cream border-r border-black/5 flex flex-col h-[calc(100vh-64px)] overflow-hidden">
      <div className="p-5 flex-1 flex flex-col gap-6 overflow-hidden">
        
        {/* Section 1: Reference Upload */}
        <section className="flex-none">
          <RefUpload />
        </section>

        {/* Section 2: Source Images Grid (Scrollable) */}
        <section className="flex-1 flex flex-col min-h-0">
          <SourceGrid />
        </section>

        {/* Action Area */}
        <section className="flex-none pt-4 space-y-3 border-t border-black/5">
          <Button 
            variant="primary" 
            size="lg" 
            className="w-full text-base font-serif shadow-soft hover:shadow-lg transition-all"
            disabled={!canGenerate}
            isLoading={isProcessing}
            onClick={startGeneration}
            leftIcon={<MagicWand size={20} weight="fill" />}
          >
            {isProcessing ? 'Synthesizing...' : 'Generate Image'}
          </Button>

          {(referenceImage || sourceImages.length > 0) && (
            <Button 
              variant="ghost" 
              size="sm" 
              className="w-full text-charcoal/50 hover:text-red-600"
              onClick={reset}
              disabled={isProcessing}
              leftIcon={<Trash size={16} />}
            >
              Reset Workbench
            </Button>
          )}
        </section>

      </div>
    </aside>
  );
};
