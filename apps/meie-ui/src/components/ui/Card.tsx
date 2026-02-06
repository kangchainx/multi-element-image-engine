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
      className={`bg-white border border-border-subtle shadow-apple hover:shadow-apple-hover rounded-xl overflow-hidden transition-all duration-300 ${className}`}
    >
      {children}
    </div>
  );
};
