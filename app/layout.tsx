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
  title: 'My Little Office — Custom Team Simulator',
  description: 'A customizable pixel-art office for visualizing teams, roles, workflows, and live operations.',
  openGraph: {
    title: 'My Little Office — Custom Team Simulator',
    description: 'A customizable pixel-art office demo featuring a modern software development team.',
    url: 'https://shorts-foundry.malvas.chatgpt.site',
    siteName: 'My Little Office',
    images: [{ url: 'https://shorts-foundry.malvas.chatgpt.site/assets/office/rustic-office.png', width: 1664, height: 936, alt: 'My Little Office software team simulator' }],
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'My Little Office — Custom Team Simulator',
    description: 'A customizable pixel-art office demo for software development teams.',
    images: ['https://shorts-foundry.malvas.chatgpt.site/assets/office/rustic-office.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
