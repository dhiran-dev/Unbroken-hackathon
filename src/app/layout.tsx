import type { Metadata, Viewport } from "next";

import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "PulseRank — Know what moves you",
    template: "%s — PulseRank",
  },
  description:
    "Explore caffeine products through trusted source observations, explicit field states, and transparent rankings.",
  applicationName: "PulseRank",
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#050711",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html data-scroll-behavior="smooth" lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="class" defaultTheme="dark" disableTransitionOnChange>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
