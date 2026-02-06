import React from 'react';
import { User, Bell } from 'phosphor-react';
import { Button } from '../ui/Button';

export const Header: React.FC = () => {
  return (
    <header className="h-14 flex items-center justify-between px-6 glass sticky top-0 z-50">
      <div className="flex items-center gap-3">
        {/* Minimalist Logo */}
        <div className="w-8 h-8 bg-black rounded-lg flex items-center justify-center text-white font-display font-medium text-lg shadow-sm">
          M
        </div>
        <h1 className="font-display text-lg font-medium text-text-primary tracking-tight">
          MEIE Studio
        </h1>
      </div>
      
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" className="rounded-full w-9 h-9 p-0 text-text-secondary hover:text-text-primary">
          <Bell size={20} />
        </Button>
        <div className="h-6 w-[1px] bg-border-subtle mx-1" />
        <Button variant="ghost" size="sm" className="flex items-center gap-2 pl-1 pr-3 hover:bg-black/5 rounded-full">
          <div className="w-7 h-7 rounded-full bg-border-subtle flex items-center justify-center overflow-hidden text-text-secondary">
            <User size={16} weight="bold" />
          </div>
          <span className="text-sm font-medium text-text-primary">Chris</span>
        </Button>
      </div>
    </header>
  );
};
