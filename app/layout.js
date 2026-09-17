import "./globals.css";

export const metadata = {
  title: "Master of Coins",
  description: "Personal finance tracker via Telegram Bot + AI",
  icons: {
    icon: "/favicon.png",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}