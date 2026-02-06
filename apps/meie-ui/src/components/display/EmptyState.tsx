import React from 'react';
import { Aperture } from 'phosphor-react';

export const EmptyState: React.FC = () => {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center animate-fade-in">
      <div className="w-20 h-20 rounded-2xl bg-sidebar flex items-center justify-center mb-6 shadow-sm border border-border-subtle">
        <Aperture size={40} weight="light" className="text-text-secondary" />
      </div>
      <h3 className="font-display text-xl font-medium text-text-primary mb-2">
        Ready to Create
      </h3>
      <p className="max-w-xs leading-relaxed text-text-secondary text-sm">
        Upload a <span className="text-text-primary font-medium">Structure Reference</span> and select your <span className="text-text-primary font-medium">Source Elements</span> to begin.
      </p>
    </div>
  );
};
