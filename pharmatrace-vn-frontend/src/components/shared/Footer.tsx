import React from 'react';
import Link from 'next/link';
import { Pill, Globe, Share2, Phone, Mail, MapPin } from 'lucide-react';

export const Footer: React.FC = () => {
  return (
    <footer className="bg-[#004996] text-white mt-auto overflow-hidden">
      <div className="max-w-[1440px] mx-auto px-4 py-12 md:py-16">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-12 lg:gap-8">
          {/* About */}
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-white flex items-center justify-center shadow-lg">
                <Pill className="w-6 h-6 text-[#004996]" />
              </div>
              <div>
                <span className="text-white font-bold text-2xl block leading-none">PharmaTrace VN</span>
                <span className="text-[10px] text-white/80 font-bold tracking-widest uppercase">Health & Care</span>
              </div>
            </div>
            <p className="text-sm leading-relaxed text-white/90 font-medium max-w-xs">
              Hệ thống chuỗi cung ứng dược phẩm minh bạch, chống giả hàng đầu Việt Nam sử dụng công nghệ Dual-Code QR và OTP mã hóa HMAC/AES.
            </p>
            <div className="flex gap-4">
              <a href="#" className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center hover:bg-white hover:text-[#004996] transition-all">
                <Globe className="w-5 h-5 text-white" />
              </a>
              <a href="#" className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center hover:bg-white hover:text-[#004996] transition-all">
                <Share2 className="w-5 h-5 text-white" />
              </a>
            </div>
          </div>

          {/* Links Column 1 */}
          <div>
            <h4 className="text-white font-bold text-sm uppercase tracking-widest mb-6 border-b border-white/20 pb-2">
              Sản Phẩm Nổi Bật
            </h4>
            <ul className="space-y-3 text-[13px] font-semibold text-white/90">
              <li>
                <Link href="/products" className="hover:text-emerald-300 transition-colors">
                  Thực phẩm chức năng
                </Link>
              </li>
              <li>
                <Link href="/products" className="hover:text-emerald-300 transition-colors">
                  Thuốc không kê đơn (OTC)
                </Link>
              </li>
              <li>
                <Link href="/products" className="hover:text-emerald-300 transition-colors">
                  Thuốc kê đơn (Rx)
                </Link>
              </li>
              <li>
                <Link href="/products" className="hover:text-emerald-300 transition-colors">
                  Dược mỹ phẩm cao cấp
                </Link>
              </li>
              <li>
                <Link href="/products" className="hover:text-emerald-300 transition-colors">
                  Thiết bị y tế gia đình
                </Link>
              </li>
            </ul>
          </div>

          {/* Links Column 2 */}
          <div>
            <h4 className="text-white font-bold text-sm uppercase tracking-widest mb-6 border-b border-white/20 pb-2">
              Hỗ Trợ Khách Hàng
            </h4>
            <ul className="space-y-3 text-[13px] font-semibold text-white/90">
              <li>
                <Link href="/account/orders" className="hover:text-emerald-300 transition-colors">
                  Đơn hàng của tôi
                </Link>
              </li>
              <li>
                <Link href="/trace" className="hover:text-emerald-300 transition-colors text-emerald-300 font-bold">
                  Tra cứu nguồn gốc thuốc (QR)
                </Link>
              </li>
              <li>
                <Link href="/blog" className="hover:text-emerald-300 transition-colors">
                  Blog sức khỏe y tế
                </Link>
              </li>
              <li>
                <Link href="#" className="hover:text-emerald-300 transition-colors">
                  Chính sách đổi trả RMA
                </Link>
              </li>
              <li>
                <Link href="#" className="hover:text-emerald-300 transition-colors">
                  Điều khoản sử dụng
                </Link>
              </li>
            </ul>
          </div>

          {/* Contact */}
          <div>
            <h4 className="text-white font-bold text-sm uppercase tracking-widest mb-6 border-b border-white/20 pb-2">
              Liên Hệ & Tổng Đài
            </h4>
            <ul className="space-y-4">
              <li className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg bg-white flex items-center justify-center shrink-0 shadow-md">
                  <Phone className="w-4 h-4 text-[#004996]" />
                </div>
                <div>
                  <p className="text-white/70 text-[10px] uppercase font-bold">Tổng đài miễn cước</p>
                  <p className="text-white font-bold text-base leading-none mt-0.5">1800 6821</p>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg bg-white flex items-center justify-center shrink-0 shadow-md">
                  <Mail className="w-4 h-4 text-[#004996]" />
                </div>
                <div>
                  <p className="text-white/70 text-[10px] uppercase font-bold">Email hỗ trợ</p>
                  <p className="text-white font-bold text-sm mt-0.5">support@pharmatrace.vn</p>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg bg-white flex items-center justify-center shrink-0 shadow-md">
                  <MapPin className="w-4 h-4 text-[#004996]" />
                </div>
                <div>
                  <p className="text-white/70 text-[10px] uppercase font-bold">Trụ sở chính</p>
                  <p className="text-white font-bold text-sm mt-0.5">TP. Hồ Chí Minh, Việt Nam</p>
                </div>
              </li>
            </ul>
          </div>
        </div>
      </div>

      <div className="bg-[#004084] py-4 border-t border-white/10">
        <div className="max-w-[1440px] mx-auto px-4 flex flex-col md:flex-row items-center justify-between gap-4 text-[11px] font-bold text-white/80 uppercase tracking-wider">
          <p>© 2026 PharmaTrace VN. All rights reserved.</p>
          <div className="flex gap-6">
            <Link href="#" className="hover:text-emerald-300 transition-colors">Bảo mật thông tin</Link>
            <Link href="#" className="hover:text-emerald-300 transition-colors">Điều khoản dịch vụ</Link>
            <Link href="#" className="hover:text-emerald-300 transition-colors">Giấy phép GPP / GDP</Link>
          </div>
        </div>
      </div>
    </footer>
  );
};
