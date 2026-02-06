import React from 'react';
import { Aperture } from 'phosphor-react';

export const EmptyState: React.FC = () => {
  return (
    <div className="flex flex-col items-center justify-center h-full text-charcoal/40 animate-fade-in">
      <div className="w-24 h-24 rounded-full bg-cream flex items-center justify-center mb-6 shadow-inner-soft">
        <Aperture size={48} weight="light" className="text-terracotta/60" />
      </div>
      <h3 className="font-serif text-2xl font-medium text-charcoal/60 mb-2">
        Ready to Create
      </h3>
      <p className="text-center max-w-sm leading-relaxed">
        Upload a <span className="text-terracotta font-medium">Structure Reference</span> and select your <span className="text-terracotta font-medium">Source Elements</span> to begin the synthesis properly.
      </p>
    </div>
  );
};
