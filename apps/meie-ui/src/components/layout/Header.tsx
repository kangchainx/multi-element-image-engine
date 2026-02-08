import React from 'react';

export const Header: React.FC = () => {
  return (
    <header className="h-14 flex items-center justify-between px-6 glass sticky top-0 z-50">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 bg-black rounded-lg flex items-center justify-center text-white font-display font-medium text-lg shadow-sm">
          M
        </div>
        <h1 className="font-display text-lg font-medium text-text-primary tracking-tight">MEIE 工作台</h1>
      </div>
    </header>
  );
};
