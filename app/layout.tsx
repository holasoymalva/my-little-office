import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Shorts Foundry — AI Content Operations',
  description: 'Centro visual de operaciones para coordinar agentes de contenido y producir YouTube Shorts.',
  openGraph: {
    title: 'Shorts Foundry — AI Content Operations',
    description: 'Una oficina pixel art donde agentes de IA investigan, escriben, producen y programan Shorts.',
    url: 'https://shorts-foundry.malvas.chatgpt.site',
    siteName: 'Shorts Foundry',
    images: [{ url: 'https://shorts-foundry.malvas.chatgpt.site/og.png', width: 1200, height: 630, alt: 'Shorts Foundry AI Content Operations' }],
    locale: 'es_MX',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Shorts Foundry — AI Content Operations',
    description: 'Una oficina pixel art donde agentes de IA coordinan la producción de Shorts.',
    images: ['https://shorts-foundry.malvas.chatgpt.site/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
