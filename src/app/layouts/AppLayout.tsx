import React from 'react';
import { Outlet } from 'react-router-dom';
import { Navbar } from '../navigation/Navbar';

export const AppLayout: React.FC = () => {
  return (
    <div className="min-h-screen bg-[#101010] text-[#F5F1E8] flex flex-col">
      <Navbar />
      <main className="flex-1 pb-20 md:pb-8 max-w-7xl w-full mx-auto p-4 md:p-8">
        <Outlet />
      </main>
    </div>
  );
};
