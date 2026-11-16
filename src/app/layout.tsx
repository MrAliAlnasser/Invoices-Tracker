import type { Metadata } from "next";
import { IBM_Plex_Sans_Arabic, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const ibmPlexArabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-arabic",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-code",
  display: "swap",
});

export const metadata: Metadata = {
  title: "فواتيري الذكية | نظام OCR لفواتير المشتريات العربية",
  description:
    "منصة سحابية حديثة لقراءة وأرشفة فواتير المشتريات العربية بالذكاء الاصطناعي مع مراجعة الأرقام والبنود سطرًا بسطر.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ar"
      dir="rtl"
      className={`${ibmPlexArabic.variable} ${jetbrainsMono.variable}`}
    >
      <body className="font-sans antialiased selection:bg-indigo-500/30 selection:text-white">
        {children}
      </body>
    </html>
  );
}
