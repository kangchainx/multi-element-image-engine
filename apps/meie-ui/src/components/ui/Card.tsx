import React from 'react';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}

export const Card: React.FC<CardProps> = ({ children, className = '', onClick }) => {
  return (
    <div 
      onClick={onClick}
      className={`bg-white border text-charcoal shadow-soft rounded-xl border-black/5 overflow-hidden transition-all duration-300 ${className}`}
    >
      {children}
    </div>
  );
};
