import type { Metadata } from 'next';
import React from 'react';

export const metadata: Metadata = {
  title: 'Football Chain',
  description: 'A daily football transfer-chain puzzle',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'Arial, sans-serif', background: '#f5f7fb', color: '#111827' }}>
        {children}
      </body>
    </html>
  );
}
