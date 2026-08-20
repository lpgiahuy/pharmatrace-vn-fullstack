-- Row Level Security (RLS) Policies for PharmaTrace VN
-- Architecture: Multi-tenant, Branch-level & Customer-level Isolation


-- 1. Helper function for RLS Bypass
CREATE OR REPLACE FUNCTION rls_can_bypass()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN (
        current_setting('app.bypass_rls', true) = 'on'
        OR current_setting('app.current_user_role', true) IN ('SuperAdmin', 'ADMIN')
        OR (
            NULLIF(current_setting('app.current_user_id', true), '') IS NULL
            AND NULLIF(current_setting('app.current_user_type', true), '') IS NULL
        )
    );
END;
$$ LANGUAGE plpgsql STABLE;

-- Helper function to get current numeric user ID
CREATE OR REPLACE FUNCTION rls_current_user_id()
RETURNS INTEGER AS $$
BEGIN
    RETURN NULLIF(current_setting('app.current_user_id', true), '')::INTEGER;
EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

-- Helper function to get current numeric unit ID
CREATE OR REPLACE FUNCTION rls_current_unit_id()
RETURNS INTEGER AS $$
BEGIN
    RETURN NULLIF(current_setting('app.current_unit_id', true), '')::INTEGER;
EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

-- 2. Customer Domain Tables (Isolation by khach_hang_id)

-- Table: giohang
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'giohang') THEN
        ALTER TABLE public.giohang ENABLE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS p_giohang ON public.giohang;
        CREATE POLICY p_giohang ON public.giohang
        FOR ALL USING (
            rls_can_bypass()
            OR current_setting('app.current_user_type', true) = 'staff'
            OR khach_hang_id = rls_current_user_id()
        );
    END IF;
END $$;

-- Table: donhang
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'donhang') THEN
        ALTER TABLE public.donhang ENABLE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS p_donhang ON public.donhang;
        CREATE POLICY p_donhang ON public.donhang
        FOR ALL USING (
            rls_can_bypass()
            OR khach_hang_id = rls_current_user_id()
            OR (
                current_setting('app.current_user_type', true) = 'staff'
                AND (
                    don_vi_xuat_id = rls_current_unit_id()
                    OR don_vi_xuat_id IS NULL
                    OR rls_current_unit_id() IS NULL
                )
            )
        );
    END IF;
END $$;

-- Table: chitietdonhang
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'chitietdonhang') THEN
        ALTER TABLE public.chitietdonhang ENABLE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS p_chitietdonhang ON public.chitietdonhang;
        CREATE POLICY p_chitietdonhang ON public.chitietdonhang
        FOR ALL USING (
            rls_can_bypass()
            OR current_setting('app.current_user_type', true) = 'staff'
            OR EXISTS (
                SELECT 1 FROM public.donhang dh 
                WHERE dh.id = chitietdonhang.don_hang_id 
                AND dh.khach_hang_id = rls_current_user_id()
            )
        );
    END IF;
END $$;

-- Table: toathuoc
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'toathuoc') THEN
        ALTER TABLE public.toathuoc ENABLE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS p_toathuoc ON public.toathuoc;
        CREATE POLICY p_toathuoc ON public.toathuoc
        FOR ALL USING (
            rls_can_bypass()
            OR current_setting('app.current_user_type', true) = 'staff'
            OR khach_hang_id = rls_current_user_id()
        );
    END IF;
END $$;

-- Table: danhgia_sanpham
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'danhgia_sanpham') THEN
        ALTER TABLE public.danhgia_sanpham ENABLE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS p_danhgia_sanpham_select ON public.danhgia_sanpham;
        CREATE POLICY p_danhgia_sanpham_select ON public.danhgia_sanpham
        FOR SELECT USING (true);

        DROP POLICY IF EXISTS p_danhgia_sanpham_mod ON public.danhgia_sanpham;
        CREATE POLICY p_danhgia_sanpham_mod ON public.danhgia_sanpham
        FOR ALL USING (
            rls_can_bypass()
            OR khach_hang_id = rls_current_user_id()
        );
    END IF;
END $$;

-- 3. Warehouse & Facility Domain (Isolation by don_vi_id)

-- Table: tonkho_donvi
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'tonkho_donvi') THEN
        ALTER TABLE public.tonkho_donvi ENABLE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS p_tonkho_donvi ON public.tonkho_donvi;
        CREATE POLICY p_tonkho_donvi ON public.tonkho_donvi
        FOR ALL USING (
            rls_can_bypass()
            OR don_vi_id = rls_current_unit_id()
            OR rls_current_unit_id() IS NULL
        );
    END IF;
END $$;

-- Table: mahop_uid
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'mahop_uid') THEN
        ALTER TABLE public.mahop_uid ENABLE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS p_mahop_uid ON public.mahop_uid;
        CREATE POLICY p_mahop_uid ON public.mahop_uid
        FOR ALL USING (
            rls_can_bypass()
            OR don_vi_hien_tai_id = rls_current_unit_id()
            OR rls_current_unit_id() IS NULL
        );
    END IF;
END $$;

-- Table: kienhang_sscc
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'kienhang_sscc') THEN
        ALTER TABLE public.kienhang_sscc ENABLE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS p_kienhang_sscc ON public.kienhang_sscc;
        CREATE POLICY p_kienhang_sscc ON public.kienhang_sscc
        FOR ALL USING (
            rls_can_bypass()
            OR don_vi_hien_tai_id = rls_current_unit_id()
            OR rls_current_unit_id() IS NULL
        );
    END IF;
END $$;

-- Table: phieunhap
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'phieunhap') THEN
        ALTER TABLE public.phieunhap ENABLE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS p_phieunhap ON public.phieunhap;
        CREATE POLICY p_phieunhap ON public.phieunhap
        FOR ALL USING (
            rls_can_bypass()
            OR nha_cung_cap_id = rls_current_unit_id()
            OR rls_current_unit_id() IS NULL
        );
    END IF;
END $$;

-- Table: vanchuyen
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'vanchuyen') THEN
        ALTER TABLE public.vanchuyen ENABLE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS p_vanchuyen ON public.vanchuyen;
        CREATE POLICY p_vanchuyen ON public.vanchuyen
        FOR ALL USING (
            rls_can_bypass()
            OR current_setting('app.current_user_type', true) = 'staff'
            OR EXISTS (
                SELECT 1 FROM public.donhang dh 
                WHERE dh.id = vanchuyen.don_hang_id 
                AND dh.khach_hang_id = rls_current_user_id()
            )
        );
    END IF;
END $$;

-- 4. Public Catalog Domain (Read: ALL, Modify: Admin/Staff)

-- Table: duocpham
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'duocpham') THEN
        ALTER TABLE public.duocpham ENABLE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS p_duocpham_select ON public.duocpham;
        CREATE POLICY p_duocpham_select ON public.duocpham FOR SELECT USING (true);
        DROP POLICY IF EXISTS p_duocpham_mod ON public.duocpham;
        CREATE POLICY p_duocpham_mod ON public.duocpham FOR ALL USING (
            rls_can_bypass()
            OR current_setting('app.current_user_type', true) = 'staff'
        );
    END IF;
END $$;

-- Table: danhmuc
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'danhmuc') THEN
        ALTER TABLE public.danhmuc ENABLE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS p_danhmuc_select ON public.danhmuc;
        CREATE POLICY p_danhmuc_select ON public.danhmuc FOR SELECT USING (true);
        DROP POLICY IF EXISTS p_danhmuc_mod ON public.danhmuc;
        CREATE POLICY p_danhmuc_mod ON public.danhmuc FOR ALL USING (
            rls_can_bypass()
            OR current_setting('app.current_user_type', true) = 'staff'
        );
    END IF;
END $$;

-- Table: quycachdonggoi
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'quycachdonggoi') THEN
        ALTER TABLE public.quycachdonggoi ENABLE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS p_quycachdonggoi_select ON public.quycachdonggoi;
        CREATE POLICY p_quycachdonggoi_select ON public.quycachdonggoi FOR SELECT USING (true);
        DROP POLICY IF EXISTS p_quycachdonggoi_mod ON public.quycachdonggoi;
        CREATE POLICY p_quycachdonggoi_mod ON public.quycachdonggoi FOR ALL USING (
            rls_can_bypass()
            OR current_setting('app.current_user_type', true) = 'staff'
        );
    END IF;
END $$;

-- Table: baiviet
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'baiviet') THEN
        ALTER TABLE public.baiviet ENABLE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS p_baiviet_select ON public.baiviet;
        CREATE POLICY p_baiviet_select ON public.baiviet FOR SELECT USING (true);
        DROP POLICY IF EXISTS p_baiviet_mod ON public.baiviet;
        CREATE POLICY p_baiviet_mod ON public.baiviet FOR ALL USING (
            rls_can_bypass()
            OR current_setting('app.current_user_type', true) = 'staff'
        );
    END IF;
END $$;

-- Table: donvi
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'donvi') THEN
        ALTER TABLE public.donvi ENABLE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS p_donvi_select ON public.donvi;
        CREATE POLICY p_donvi_select ON public.donvi FOR SELECT USING (true);
        DROP POLICY IF EXISTS p_donvi_mod ON public.donvi;
        CREATE POLICY p_donvi_mod ON public.donvi FOR ALL USING (
            rls_can_bypass()
            OR current_setting('app.current_user_type', true) = 'staff'
        );
    END IF;
END $$;
