import type { Metadata } from "next";
import { DM_Sans, Lora } from "next/font/google";
import { headers } from "next/headers";
import FeedbackLauncher from "./_components/feedback-launcher";
import "./globals.css";

const sans = DM_Sans({ variable: "--font-sans", subsets: ["latin"] });
const serif = Lora({ variable: "--font-serif", subsets: ["latin"] });

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const metadataBase = new URL(`${protocol}://${host}`);
  const image = new URL("/og.png", metadataBase).toString();
  return {
    metadataBase,
    title: { default: "Hearthland — Build places to belong", template: "%s · Hearthland" },
    description: "Find people, form regenerative communities, discover land, learn together and build a real place to live.",
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
    alternates: { canonical: "/" },
    openGraph: {
      title: "Hearthland — Create places where people can live, learn and build together",
      description: "Digital infrastructure for real regenerative communities.",
      type: "website",
      url: "/",
      images: [{ url: image, width: 1200, height: 630, alt: "Hearthland — Create places where people can live, learn and build together" }],
    },
    twitter: { card: "summary_large_image", title: "Hearthland", description: "Find people. Form a community. Build a place to live.", images: [image] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body className={`${sans.variable} ${serif.variable}`}>{children}<FeedbackLauncher /></body></html>;
}
