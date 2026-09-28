import type { Metadata } from "next";
import { connection } from "next/server";
import { DM_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const dmSans = DM_Sans({ subsets: ["latin"], variable: "--font-sans" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "VoteChain | Election operations",
  description: "An educational prototype for verifiable election workflows.",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await connection();

  return (
    <html lang="en">
      <body className={`${dmSans.variable} ${plexMono.variable}`}>{children}</body>
    </html>
  );
}