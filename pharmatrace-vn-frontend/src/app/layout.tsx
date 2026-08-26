import type { Metadata } from "next";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import { ConfigProvider, App } from "antd";
import viVN from "antd/locale/vi_VN";
import "./globals.css";

export const metadata: Metadata = {
  title: "PharmaTrace VN - Nền Tảng Truy Xuất Nguồn Gốc & Chuỗi Cung Ứng Dược Phẩm",
  description: "Hệ thống truy xuất nguồn gốc thuốc bằng mã kép Dual-Code QR và OTP bảo mật",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi">
      <body>
        <AntdRegistry>
          <ConfigProvider
            locale={viVN}
            theme={{
              token: {
                colorPrimary: "#004996",
                colorSuccess: "#00A551",
                colorWarning: "#f7941d",
                colorError: "#ed1c24",
                borderRadius: 8,
                fontFamily: "'Be Vietnam Pro', 'Inter', sans-serif",
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
