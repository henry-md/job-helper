import type { Metadata } from "next";
import { Cormorant_Garamond, DM_Sans, Geist } from "next/font/google";
import AppToaster from "@/components/app-toaster";
import "./globals.css";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

const sans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
});

const serif = Cormorant_Garamond({
  variable: "--font-cormorant",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Job Helper",
  description: "Google-authenticated workspace for a premium job search flow.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={cn("font-sans", geist.variable)}>
      <body className={`${sans.variable} ${serif.variable} antialiased`}>
        {children}
        <AppToaster />
      </body>
    </html>
  );
}
