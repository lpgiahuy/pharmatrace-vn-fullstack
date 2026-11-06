'use client';

import { useHydrated } from '@/hooks/useHydrated';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  Button as AButton,
  Modal,
  Form,
  Input,
  Popconfirm,
  InputNumber,
  Select,
  Switch,
  AutoComplete,
  message,
  Tooltip,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  SearchOutlined,
  PlusCircleOutlined,
  ReloadOutlined,
  DownOutlined,
} from '@ant-design/icons';
import { useAuthStore } from '@/store/useAuthStore';
import { categoryService } from '@/services/category.service';
import { Category } from '@/types/category.types';
import { CategoryIcon, PRESET_CATEGORY_ICONS } from '@/components/common/CategoryIcon';
import { cn } from '@/utils';

interface TreeNodeCategory extends Category {
  children?: Category[];
  totalSubCategories?: number;
}

const buildCategoryTree = (flatList: Category[]): TreeNodeCategory[] => {
  const map = new Map<number, TreeNodeCategory>();
  const tree: TreeNodeCategory[] = [];

  flatList.forEach((item) => {
    map.set(item.id, { ...item, children: [] });
  });

  flatList.forEach((item) => {
    const mappedItem = map.get(item.id)!;
    if (item.parentId && map.has(item.parentId)) {
      const parent = map.get(item.parentId)!;
      if (!parent.children) parent.children = [];
      parent.children.push(mappedItem);
    } else {
      tree.push(mappedItem);
    }
  });

  tree.forEach((parent) => {
    parent.totalSubCategories = parent.children?.length || 0;
    if (parent.children) {
      parent.children.sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
    }
  });

  tree.sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
  return tree;
};

const getParentIconKey = (parent: Category, index: number) => {
  if (parent.icon && parent.icon.trim()) return parent.icon;
  const name = parent.categoryName.toLowerCase();
  if (name.includes('family') || name.includes('cabinet') || name.includes('gia đình')) return 'pill';
  if (name.includes('specialty') || name.includes('đặc trị')) return 'experiment';
  if (name.includes('vitamin') || name.includes('supplement') || name.includes('thực phẩm')) return 'shield';
  if (name.includes('sexual') || name.includes('sinh lý')) return 'heart';
  if (name.includes('other') || name.includes('khác')) return 'medical';

  const defaultKeys = ['pill', 'experiment', 'shield', 'heart', 'medical'];
  return defaultKeys[index % defaultKeys.length];
};

export default function CategoriesPage() {
  const router = useRouter();
  const getIsAuthenticated = useAuthStore((state) => state.getIsAuthenticated);
  const getUser = useAuthStore((state) => state.getUser);

  const [messageApi, contextHolder] = message.useMessage();
  const mounted = useHydrated();
  const [rawCats, setRawCats] = useState<Category[]>([]);
  const [cats, setCats] = useState<TreeNodeCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [viewingCategory, setViewingCategory] = useState<Category | null>(null);
  const [editing, setEditing] = useState<Category | null>(null);
  const [presetParentId, setPresetParentId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const selectedParentId = Form.useWatch('danh_muc_cha_id', form);

  const [searchQuery, setSearchQuery] = useState('');
  const [expandedIds, setExpandedIds] = useState<number[]>([]);

  const isAuthenticated = mounted ? getIsAuthenticated() : false;
  const user = mounted ? getUser() : null;

  useEffect(() => {
    if (mounted && !isAuthenticated) {
      router.push('/admin/login');
    }
  }, [mounted, isAuthenticated, router]);

  const fetchCategories = useCallback(async () => {
    try {
      setLoading(true);
      const res = await categoryService.getCategories();
      const flatList: Category[] = res?.data || [];
      setRawCats(flatList);
      const tree = buildCategoryTree(flatList);
      setCats(tree);
      // Default to collapsed (empty expandedIds)
      setExpandedIds([]);
    } catch (err: any) {
      messageApi.error(err?.message || 'Failed to fetch categories');
    } finally {
      setLoading(false);
    }
  }, [messageApi]);

  useEffect(() => {
    // Cancel pending work when dependencies change or the component unmounts.
    const timer = setTimeout(() => {
      if (mounted && isAuthenticated) {
        fetchCategories();
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [mounted, isAuthenticated, fetchCategories]);

  const stats = useMemo(() => {
    const total = rawCats.length;
    const parentCount = cats.length;
    const subCount = rawCats.filter((c) => !!c.parentId).length;
    const activeCount = rawCats.filter((c) => (c.status || 'ACTIVE').toUpperCase() === 'ACTIVE').length;
    return { total, parentCount, subCount, activeCount };
  }, [rawCats, cats]);

  const filteredParents = useMemo(() => {
    if (!searchQuery.trim()) return cats;
    const q = searchQuery.toLowerCase();

    return cats
      .map((parent) => {
        const parentMatch = parent.categoryName.toLowerCase().includes(q) || (parent.description || '').toLowerCase().includes(q);
        const matchingChildren = (parent.children || []).filter(
          (child) => child.categoryName.toLowerCase().includes(q) || (child.description || '').toLowerCase().includes(q)
        );

        if (parentMatch) {
          return parent;
        }

        if (matchingChildren.length > 0) {
          return {
            ...parent,
            children: matchingChildren,
          };
        }

        return null;
      })
      .filter((item): item is TreeNodeCategory => item !== null);
  }, [cats, searchQuery]);

  const [previousFilteredParents, setPreviousFilteredParents] = useState(filteredParents);
  const [previousSearchQuery, setPreviousSearchQuery] = useState(searchQuery);
  if (previousFilteredParents !== filteredParents || previousSearchQuery !== searchQuery) {
    setPreviousFilteredParents(filteredParents);
    setPreviousSearchQuery(searchQuery);
    if (searchQuery.trim()) setExpandedIds(filteredParents.map((p) => p.id));
  }

  const toggleExpand = (id: number) => {
    setExpandedIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const handleExpandAll = () => {
    setExpandedIds(cats.map((c) => c.id));
  };

  const handleCollapseAll = () => {
    setExpandedIds([]);
  };

  const openModal = (category?: Category | null, parentIdPreset?: number | null) => {
    setEditing(category || null);
    setPresetParentId(parentIdPreset || null);

    if (category) {
      form.setFieldsValue({
        ten_danh_muc: category.categoryName,
        mo_ta: category.description || '',
        danh_muc_cha_id: category.parentId || undefined,
        thu_tu_hien_thi: category.displayOrder ?? 0,
        hinh_anh_icon: category.icon || '',
        trang_thai: (category.status || 'ACTIVE').toUpperCase() === 'ACTIVE',
      });
    } else {
      form.resetFields();
      form.setFieldsValue({
        danh_muc_cha_id: parentIdPreset || undefined,
        thu_tu_hien_thi: 0,
        trang_thai: true,
        hinh_anh_icon: '',
      });
    }
    setOpen(true);
  };

  const openDetailModal = (category: Category) => {
    setViewingCategory(category);
    setDetailModalOpen(true);
  };

  const handleSave = async (values: any) => {
    try {
      setSaving(true);
      const payload = {
        categoryName: values.ten_danh_muc,
        description: values.mo_ta || undefined,
        parentId: values.danh_muc_cha_id ? Number(values.danh_muc_cha_id) : null,
        displayOrder: values.thu_tu_hien_thi !== undefined ? Number(values.thu_tu_hien_thi) : 0,
        icon: values.danh_muc_cha_id ? undefined : (values.hinh_anh_icon || undefined),
        status: values.trang_thai ? 'ACTIVE' : 'INACTIVE',
      };

      if (editing) {
        await categoryService.updateCategory(editing.id, payload);
        messageApi.success('Category updated successfully');
      } else {
        await categoryService.createCategory(payload);
        messageApi.success('Category created successfully');
      }

      setOpen(false);
      fetchCategories();
    } catch (err: any) {
      messageApi.error(err?.message || 'Failed to save category');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await categoryService.deleteCategory(id);
      messageApi.success('Category deleted');
      fetchCategories();
    } catch (err: any) {
      messageApi.error(err?.message || 'Failed to delete category');
    }
  };

  if (!mounted || !isAuthenticated || !user) {
    return null;
  }

  return (
    <>
      {contextHolder}

      <div className="space-y-5 animate-fade-in font-sans w-full">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-1">
          <div>
            <h1 className="text-xl font-bold text-slate-900 m-0 tracking-tight">
              Product Categories
            </h1>
            <p className="text-slate-500 text-xs m-0 mt-0.5">
              Manage medical taxonomy hierarchy and classifications
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={fetchCategories}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[6px] border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
            >
              <ReloadOutlined className={cn(loading && 'animate-spin')} />
              Refresh
            </button>
            <button
              type="button"
              onClick={() => openModal()}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-[6px] bg-[#1e4287] hover:bg-[#163266] text-white text-xs font-medium transition-colors cursor-pointer border-none shadow-xs"
            >
              <PlusOutlined />
              Add Category
            </button>
          </div>
        </div>

        {/* Stat */}
        <div className="bg-white px-5 py-3.5 rounded-[6px] border border-slate-200/80 shadow-xs flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-6 sm:gap-8 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400 font-medium uppercase tracking-wider">Total</span>
              <span className="text-sm font-bold text-slate-900">{stats.total}</span>
            </div>
            <div className="h-3.5 w-px bg-slate-200" />
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400 font-medium uppercase tracking-wider">Groups</span>
              <span className="text-sm font-bold text-slate-900">{stats.parentCount}</span>
            </div>
            <div className="h-3.5 w-px bg-slate-200" />
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400 font-medium uppercase tracking-wider">Sub-categories</span>
              <span className="text-sm font-bold text-slate-900">{stats.subCount}</span>
            </div>
            <div className="h-3.5 w-px bg-slate-200" />
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400 font-medium uppercase tracking-wider">Active</span>
              <span className="text-sm font-bold text-emerald-600">{stats.activeCount}</span>
            </div>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-sm">
            <Input
              placeholder="Search category name..."
              prefix={<SearchOutlined className="text-slate-400 text-xs" />}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              allowClear
              className="rounded-[6px] h-9 border-slate-200 text-xs bg-white"
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleExpandAll}
              className="px-2.5 py-1 text-xs text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-[6px] transition-colors border border-slate-200 bg-white cursor-pointer"
            >
              Expand all
            </button>
            <button
              type="button"
              onClick={handleCollapseAll}
              className="px-2.5 py-1 text-xs text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-[6px] transition-colors border border-slate-200 bg-white cursor-pointer"
            >
              Collapse all
            </button>
          </div>
        </div>

        {/* Category Accordion List */}
        <div className="space-y-3">
          {filteredParents.map((parent, pIndex) => {
            const isExpanded = expandedIds.includes(parent.id);
            const subList = parent.children || [];
            const isParentActive = (parent.status || 'ACTIVE').toUpperCase() === 'ACTIVE';

            return (
              <div
                key={parent.id}
                className="rounded-[6px] border border-slate-200/80 bg-white overflow-hidden transition-all shadow-xs"
              >
                {/* Accordion Card Header */}
                <div
                  className="px-4 py-3 sm:px-5 sm:py-3.5 flex items-center justify-between gap-3 cursor-pointer select-none hover:bg-slate-50/70 transition-colors"
                  onClick={() => toggleExpand(parent.id)}
                >
                  {/* Left: Parent Icon + Title + Meta */}
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="w-8 h-8 rounded-[6px] bg-slate-100 text-slate-600 flex items-center justify-center shrink-0 text-sm border border-slate-200/60">
                      <CategoryIcon icon={getParentIconKey(parent, pIndex)} size={16} className="text-slate-600" />
                    </div>

                    <div className="min-w-0 flex-1 flex items-center gap-2.5 flex-wrap">
                      <span className="text-sm font-semibold text-slate-900">
                        {parent.categoryName}
                      </span>

                      <span className="text-[11px] font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded-[6px]">
                        {subList.length} {subList.length === 1 ? 'sub-category' : 'sub-categories'}
                      </span>

                      <span className="text-[11px] font-mono text-slate-400">
                        #{parent.displayOrder ?? 0}
                      </span>
                    </div>
                  </div>

                  {/* Right: Status + Actions */}
                  <div
                    className="flex items-center gap-3 shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span className="inline-flex items-center gap-1.5 text-xs text-slate-500 font-medium">
                      <span
                        className={cn(
                          'w-1.5 h-1.5 rounded-full',
                          isParentActive ? 'bg-emerald-500' : 'bg-slate-300',
                        )}
                      />
                      {isParentActive ? 'Active' : 'Hidden'}
                    </span>

                    <button
                      type="button"
                      onClick={() => toggleExpand(parent.id)}
                      className="w-7 h-7 rounded-[6px] flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors border-none bg-transparent cursor-pointer p-0"
                    >
                      <DownOutlined
                        className={cn(
                          'text-xs transition-transform duration-200',
                          isExpanded && 'rotate-180 text-slate-700',
                        )}
                      />
                    </button>
                  </div>
                </div>

                {/* Sub-categories Area */}
                {isExpanded && (
                  <div className="border-t border-slate-100 bg-slate-50/40 p-3 sm:p-4">
                    {/* Toolbar */}
                    <div className="flex items-center justify-between gap-2 mb-3 px-1">
                      <span className="text-xs text-slate-500">
                        Sub-categories under {parent.categoryName}
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => openModal(null, parent.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-[#1e4287] hover:bg-blue-50/80 rounded-[6px] transition-colors border border-blue-200/60 bg-white cursor-pointer"
                        >
                          <PlusCircleOutlined className="text-xs" />
                          Add sub-category
                        </button>
                        <button
                          type="button"
                          onClick={() => openDetailModal(parent)}
                          className="px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-[6px] transition-colors border border-slate-200 bg-white cursor-pointer"
                        >
                          Details
                        </button>
                      </div>
                    </div>

                    {subList.length === 0 ? (
                      <div className="py-6 text-center bg-white rounded-[6px] border border-dashed border-slate-200">
                        <p className="text-xs text-slate-500 mb-2">No sub-categories yet</p>
                        <button
                          type="button"
                          onClick={() => openModal(null, parent.id)}
                          className="px-2.5 py-1 text-xs font-medium text-[#1e4287] hover:bg-blue-50 rounded-[6px] border border-blue-200 bg-white cursor-pointer"
                        >
                          Add first sub-category
                        </button>
                      </div>
                    ) : (
                      <div className="bg-white rounded-[6px] border border-slate-200/80 divide-y divide-slate-100 overflow-hidden">
                        {subList.map((child, cIndex) => {
                          return (
                            <div
                              key={child.id}
                              className="flex items-center justify-between px-3.5 py-2.5 hover:bg-slate-50/60 transition-colors gap-3"
                            >
                              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                <span className="text-[11px] font-mono text-slate-400 w-4 shrink-0 text-right">
                                  {cIndex + 1}.
                                </span>
                                <span className="text-xs font-medium text-slate-800 truncate">
                                  {child.categoryName}
                                </span>
                                {child.description && (
                                  <span className="text-[11px] text-slate-400 truncate max-w-xs hidden sm:inline">
                                    — {child.description}
                                  </span>
                                )}
                              </div>

                              <div className="shrink-0 flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => openDetailModal(child)}
                                  className="px-2 py-0.5 text-xs text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-[6px] transition-colors border border-slate-200 bg-white cursor-pointer"
                                >
                                  Detail
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Category Detail Modal */}
        <Modal
          title={
            <div className="flex items-center justify-between pr-6 pb-2 border-b border-slate-100">
              <span className="text-base font-semibold text-slate-900">Category Details</span>
              {viewingCategory && (
                <span className="text-xs font-medium text-slate-500">
                  Status: {(viewingCategory.status || 'ACTIVE').toUpperCase()}
                </span>
              )}
            </div>
          }
          open={detailModalOpen}
          onCancel={() => setDetailModalOpen(false)}
          centered
          width={480}
          footer={
            viewingCategory ? (
              <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                {(() => {
                  const subCount = rawCats.filter((c) => c.parentId === viewingCategory.id).length;
                  if (subCount > 0) {
                    return (
                      <Tooltip title={`Cannot delete parent category: contains ${subCount} sub-category(ies). Delete all sub-categories first.`}>
                        <AButton danger disabled icon={<DeleteOutlined />} size="small" className="opacity-50 cursor-not-allowed rounded-[6px]">
                          Delete
                        </AButton>
                      </Tooltip>
                    );
                  }
                  return (
                    <Popconfirm
                      title="Delete category?"
                      description={`Are you sure you want to permanently delete "${viewingCategory.categoryName}"?`}
                      onConfirm={async () => {
                        await handleDelete(viewingCategory.id);
                        setDetailModalOpen(false);
                      }}
                      okText="Delete"
                      cancelText="Cancel"
                      okButtonProps={{ danger: true }}
                    >
                      <AButton danger icon={<DeleteOutlined />} size="small" className="rounded-[6px]">
                        Delete
                      </AButton>
                    </Popconfirm>
                  );
                })()}

                <div className="flex items-center gap-2">
                  <AButton size="small" onClick={() => setDetailModalOpen(false)} className="rounded-[6px]">
                    Close
                  </AButton>
                  <AButton
                    type="primary"
                    size="small"
                    icon={<EditOutlined />}
                    onClick={() => {
                      setDetailModalOpen(false);
                      openModal(viewingCategory);
                    }}
                    className="bg-[#1e4287] rounded-[6px] !shadow-none"
                  >
                    Edit
                  </AButton>
                </div>
              </div>
            ) : null
          }
        >
          {viewingCategory && (
            <div className="py-2 space-y-3 text-xs">
              <div className="bg-slate-50/70 p-3.5 rounded-[6px] border border-slate-200/70 space-y-2.5">
                <div>
                  <span className="text-[11px] text-slate-400 uppercase tracking-wider block">Category Name</span>
                  <p className="text-sm font-semibold text-slate-900 m-0">{viewingCategory.categoryName}</p>
                </div>

                <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-200/50">
                  <div>
                    <span className="text-[11px] text-slate-400 uppercase tracking-wider block">Hierarchy</span>
                    <span className="text-xs text-slate-700">
                      {viewingCategory.parentId
                        ? `Sub-category of: ${rawCats.find((c) => c.id === viewingCategory.parentId)?.categoryName || `Parent #${viewingCategory.parentId}`}`
                        : 'Top-level Parent Group'}
                    </span>
                  </div>

                  <div>
                    <span className="text-[11px] text-slate-400 uppercase tracking-wider block">Display Order</span>
                    <span className="text-xs font-mono text-slate-700">
                      #{viewingCategory.displayOrder ?? 0}
                    </span>
                  </div>
                </div>

                {viewingCategory.description && (
                  <div className="pt-2 border-t border-slate-200/50">
                    <span className="text-[11px] text-slate-400 uppercase tracking-wider block">Description</span>
                    <p className="text-xs text-slate-600 m-0 leading-relaxed">{viewingCategory.description}</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </Modal>

        {/* Add / Edit Category Modal */}
        <Modal
          title={
            <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
              <span className="text-base font-semibold text-slate-900">
                {editing ? 'Edit Category' : presetParentId ? 'Add Sub-Category' : 'Create New Category'}
              </span>
            </div>
          }
          open={open}
          onCancel={() => setOpen(false)}
          onOk={() => form.submit()}
          okText="Save"
          cancelText="Cancel"
          confirmLoading={saving}
          centered
          forceRender
          width={500}
          okButtonProps={{ className: 'bg-[#1e4287] text-xs font-medium rounded-[6px] !shadow-none' }}
          cancelButtonProps={{ className: 'text-xs rounded-[6px] !shadow-none' }}
        >
          <Form form={form} layout="vertical" onFinish={handleSave} className="mt-3 space-y-2.5">
            <Form.Item
              label={<span className="font-medium text-slate-700 text-xs">Category Name</span>}
              name="ten_danh_muc"
              rules={[{ required: true, message: 'Please enter category name' }]}
            >
              <Input placeholder="e.g. Digestive Health, Antibiotics..." className="rounded-[6px] text-xs" />
            </Form.Item>

            <Form.Item
              label={<span className="font-medium text-slate-700 text-xs">Parent Category</span>}
              name="danh_muc_cha_id"
              extra={<span className="text-[11px] text-slate-400">Leave empty for top-level parent group.</span>}
            >
              <Select
                placeholder="None (Top-level Parent Category)"
                allowClear
                className="text-xs"
              >
                {rawCats
                  .filter((c) => !c.parentId && (!editing || c.id !== editing.id))
                  .map((c) => (
                    <Select.Option key={c.id} value={c.id}>
                      <span className="text-xs text-slate-800">{c.categoryName}</span>
                    </Select.Option>
                  ))}
              </Select>
            </Form.Item>

            <Form.Item
              label={<span className="font-medium text-slate-700 text-xs">Description</span>}
              name="mo_ta"
            >
              <Input.TextArea rows={2} placeholder="Optional description..." className="rounded-[6px] text-xs" />
            </Form.Item>

            {selectedParentId ? (
              <Form.Item
                label={<span className="font-medium text-slate-700 text-xs">Display Order</span>}
                name="thu_tu_hien_thi"
                className="mb-0"
              >
                <InputNumber min={0} style={{ width: '100%' }} className="rounded-[6px] text-xs" />
              </Form.Item>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
                <Form.Item
                  label={<span className="font-medium text-slate-700 text-xs">Icon Key</span>}
                  name="hinh_anh_icon"
                  className="mb-0"
                >
                  <AutoComplete
                    placeholder="Select icon (pill, heart...)"
                    allowClear
                    options={PRESET_CATEGORY_ICONS.map((item) => ({
                      value: item.value,
                      label: (
                        <div className="flex items-center gap-2 py-0.5 text-xs">
                          <span className="text-[#1e4287]">{item.icon}</span>
                          <span className="text-slate-700">{item.label}</span>
                        </div>
                      ),
                    }))}
                  />
                </Form.Item>

                <Form.Item
                  label={<span className="font-medium text-slate-700 text-xs">Display Order</span>}
                  name="thu_tu_hien_thi"
                  className="mb-0"
                >
                  <InputNumber min={0} style={{ width: '100%' }} className="rounded-[6px] text-xs" />
                </Form.Item>
              </div>
            )}

            <div className="bg-slate-50/70 p-3 rounded-[6px] border border-slate-200/70 flex items-center justify-between">
              <div>
                <p className="font-medium text-slate-800 text-xs m-0">Category Visibility</p>
                <p className="text-[11px] text-slate-400 m-0">Show in active catalog</p>
              </div>
              <Form.Item name="trang_thai" valuePropName="checked" noStyle>
                <Switch defaultChecked size="small" />
              </Form.Item>
            </div>
          </Form>
        </Modal>
      </div>
    </>
  );
}
