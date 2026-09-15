import "./globals.css";

export const metadata = {
  title: "Buku Kas",
  description: "Pencatat keuangan pribadi via Telegram Bot + AI",
};

export default function RootLayout({ children }) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
