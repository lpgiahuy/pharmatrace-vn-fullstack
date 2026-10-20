import type { Metadata } from "next";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import { ConfigProvider, App } from "antd";
import enUS from "antd/locale/en_US";
import "./globals.css";

export const metadata: Metadata = {
  title: "PharmaTrace VN - Pharmaceutical Traceability & Supply Chain Platform",
  description: "Pharmaceutical traceability platform with Dual-Code QR and secure OTP verification",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <AntdRegistry>
          <ConfigProvider
            locale={enUS}
            theme={{
              token: {
                colorPrimary: "#1e4287",
                colorLink: "#1f2937",
                colorLinkHover: "#004996",
                colorSuccess: "#00A551",
                colorWarning: "#f7941d",
                colorError: "#ed1c24",
                borderRadius: 6,
                fontFamily: "'Be Vietnam Pro', 'Inter', sans-serif",
              },
              components: {
                Button: {
                  boxShadow: "none",
                  boxShadowSecondary: "none",
                  primaryShadow: "none",
                },
              },
            }}
          >
            <App>
              {children}
            </App>
          </ConfigProvider>
        </AntdRegistry>
      </body>
    </html>
  );
}
