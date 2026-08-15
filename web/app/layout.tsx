import type { Metadata } from "next";
import { headers } from "next/headers";
import { Montserrat } from "next/font/google";
import PwaRegister from "./PwaRegister";
import "./globals.css";

const montserrat = Montserrat({
  variable: "--font-montserrat",
  subsets: ["latin"],
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  const incoming = await headers();
  const host = incoming.get("x-forwarded-host") ?? incoming.get("host") ?? "localhost:3000";
  const protocol = incoming.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https");
  const base = new URL(`${protocol}://${host}`);

  return {
    metadataBase: base,
    title: { default: "Red de Apoyo Colombia", template: "%s · Red de Apoyo" },
    description: "Ubica centros de acopio activos, revisa qué ayuda necesitan y abre la ruta más cercana.",
    applicationName: "Red de Apoyo Colombia",
    manifest: "/manifest.webmanifest",
    appleWebApp: { capable: true, statusBarStyle: "default", title: "Red de Apoyo" },
    formatDetection: { telephone: true },
    openGraph: {
      title: "Red de Apoyo",
      description: "Colombia se organiza para ayudar.",
      locale: "es_CO",
      type: "website",
      images: [{ url: new URL("/og.png", base).toString(), width: 1200, height: 630, alt: "Red de Apoyo Colombia" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Red de Apoyo",
      description: "Colombia se organiza para ayudar.",
      images: [new URL("/og.png", base).toString()],
    },
    icons: {
      icon: [{ url: "/icon-192.png", type: "image/png", sizes: "192x192" }],
      shortcut: "/icon-192.png",
      apple: [{ url: "/icon-192.png", sizes: "192x192" }],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className={`${montserrat.variable} antialiased`}>
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
