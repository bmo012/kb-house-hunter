import "./globals.css";

export const metadata = {
  title: "House Hunter",
  description: "Compare homes against two workplaces on Google Maps.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
