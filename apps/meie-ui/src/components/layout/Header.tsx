import React from 'react';
import { User, Bell } from 'phosphor-react';
import { Button } from '../ui/Button';

export const Header: React.FC = () => {
  return (
    <header className="h-16 border-b border-black/5 flex items-center justify-between px-6 bg-ivory/80 backdrop-blur-md sticky top-0 z-50">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 bg-terracotta rounded-lg flex items-center justify-center text-white font-serif font-bold text-lg shadow-sm">
          M
        </div>
        <h1 className="font-serif text-xl font-bold text-charcoal tracking-tight">
          MEIE Studio
        </h1>
      </div>
      
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" className="rounded-full w-10 h-10 p-0">
          <Bell size={20} />
        </Button>
        <div className="h-8 w-px bg-black/10 mx-1" />
        <Button variant="ghost" size="sm" className="flex items-center gap-2 pl-2 pr-4 hover:bg-black/5 rounded-full">
          <div className="w-8 h-8 rounded-full bg-cream border border-black/5 flex items-center justify-center overflow-hidden">
            <User size={16} />
          </div>
          <span className="text-sm font-medium">Chris</span>
        </Button>
      </div>
    </header>
  );
};
