import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Firetrack — one comparable fire record",
  description:
    "Harmonized MODIS and VIIRS burning activity calendar: every month in the same units, so a new satellite is not mistaken for more fire.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full bg-slate-950 text-slate-200">{children}</body>
    </html>
  );
}
