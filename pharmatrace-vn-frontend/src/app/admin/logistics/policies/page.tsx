'use client';

import { workflowErrorMessage } from '@/utils/workflow-error';
import { useCallback, useEffect, useState } from 'react';
import { Alert, App, Button, Card, Checkbox, Form, Input, InputNumber, Select, Table } from 'antd';
import { fulfillmentService, FulfillmentPolicy, FulfillmentPolicyInput, TransportRequirement, WarehousePharmacyLink } from '@/services/fulfillment.service';
import { facilityService } from '@/services/facility.service';
import { Facility } from '@/types/facility.types';
import { useAuthStore } from '@/store/useAuthStore';

interface PolicyForm extends FulfillmentPolicyInput { facilityId: number; opens: string; closes: string }
const clock = (minutes: number) => minutes === 1440 ? '24:00' : `${Math.floor(minutes / 60).toString().padStart(2, '0')}:${(minutes % 60).toString().padStart(2, '0')}`;
const minute = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
const isPharmacy = (f: Facility) => (f.rawType || f.type).toUpperCase() === 'PHARMACY';
const isWarehouse = (f: Facility) => ['CENTRAL_WAREHOUSE', 'BRANCH_WAREHOUSE'].includes(f.rawType || f.type);

const renderPaginationItem = (_page: number, type: string, originalElement: React.ReactNode) => {
  if (type === 'prev') {
    return <span className="px-1 text-slate-600 text-xs font-medium cursor-pointer">&lt; Prev</span>;
  }
  if (type === 'next') {
    return <span className="px-1 text-[#004996] text-xs font-medium cursor-pointer">Next &gt;</span>;
  }
  return originalElement;
};

export default function FulfillmentPoliciesPage() {
  const { message } = App.useApp();
  const [policies, setPolicies] = useState<FulfillmentPolicy[]>([]);
  const [requirements, setRequirements] = useState<TransportRequirement[]>([]);
  const [reqSearch, setReqSearch] = useState('');
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [warehouseLinks, setWarehouseLinks] = useState<WarehousePharmacyLink[]>([]);
  const [busy, setBusy] = useState(false);
  const user = useAuthStore.getState().getUser();
  const role = user?.role?.toUpperCase().replace(/[\s_-]/g, '');
  const allowed = ['SUPERADMIN', 'STOREMANAGER'].includes(role || '');
  const superAdmin = role === 'SUPERADMIN';
  const facilityScope = user?.facilityId;
  const [form] = Form.useForm<PolicyForm>();
  const selectedFacilityId = Form.useWatch('facilityId', form);
  const selectedFacility = facilities.find(f => f.id === selectedFacilityId);
  const sellerOptions = facilities.filter(f => isPharmacy(f) && (selectedFacility && isPharmacy(selectedFacility)
    ? f.id === selectedFacilityId
    : warehouseLinks.some(link => link.warehouse_id === selectedFacilityId && link.pharmacy_id === f.id)));
  const invalidPolicies = policies.filter(p => {
    const source = facilities.find(f => f.id === p.facility_id);
    return !source || (isPharmacy(source) ? p.selling_facility_id !== source.id
      : !warehouseLinks.some(l => l.warehouse_id === source.id && l.pharmacy_id === p.selling_facility_id));
  });
  const [linkForm] = Form.useForm<{ warehouseId: number; pharmacyIds: number[] }>();
  const [requirementForm] = Form.useForm<{ medicineId: number; condition: string }>();
  const reload = useCallback(async () => {
    const [response, options] = await Promise.all([fulfillmentService.getPolicies(), facilityService.getDropdownList()]);
    setPolicies(response.data.policies); setRequirements(response.data.requirements); setFacilities(options.data);
    setWarehouseLinks(response.data.warehouseLinks);
  }, []);
  useEffect(() => {
    let active = true;
    if (allowed) {
      Promise.all([fulfillmentService.getPolicies(), facilityService.getDropdownList()])
        .then(([response, options]) => {
          if (active) {
            setPolicies(response.data.policies);
            setRequirements(response.data.requirements);
            setWarehouseLinks(response.data.warehouseLinks);
            setFacilities(options.data);
          }
        })
        .catch(error => {
          if (active) message.error(workflowErrorMessage(error, 'Unable to load policies'));
        });
    }
    return () => { active = false; };
  }, [allowed, message]);
  const save = async (values: PolicyForm) => {
    if (minute(values.closes) <= minute(values.opens)) { message.error('Closing time must be after opening time'); return; }
    setBusy(true);
    try {
      await fulfillmentService.savePolicy(values.facilityId, {
        sellingFacilityId: values.sellingFacilityId, enabled: values.enabled, opensMinute: minute(values.opens),
        closesMinute: minute(values.closes), weekdays: values.weekdays, dailyCapacity: values.dailyCapacity,
        radiusKm: values.radiusKm, transportConditions: values.transportConditions.map(value => value.trim()),
      });
      await reload(); message.success('Fulfillment policy saved');
    } catch (error) { message.error(workflowErrorMessage(error, 'Unable to save policy')); }
    finally { setBusy(false); }
  };
  const saveRequirement = async (values: { medicineId: number; condition: string }) => {
    setBusy(true);
    try { await fulfillmentService.saveRequirement(values.medicineId, values.condition.trim()); await reload(); requirementForm.resetFields(); message.success('Transport requirement saved'); }
    catch (error) { message.error(workflowErrorMessage(error, 'Unable to save requirement')); }
    finally { setBusy(false); }
  };
  const saveLinks = async (values: { warehouseId: number; pharmacyIds: number[] }) => {
    setBusy(true);
    try {
      await fulfillmentService.setWarehouseSellingPharmacies(values.warehouseId, values.pharmacyIds);
      await reload();
      form.resetFields();
      message.success('Warehouse selling pharmacies saved');
    } catch (error) { message.error(workflowErrorMessage(error, 'Unable to save warehouse links')); }
    finally { setBusy(false); }
  };
  if (!allowed) return <Alert type="info" title="Facility managers and super administrators manage delivery policies." />;
  return (
    <div className="flex flex-col gap-6 pb-8">
      <Alert
        type="info"
        showIcon
        title="Configure before accepting orders"
        description="Each dispatch/source facility needs an enabled policy, and each medicine needs a transport classification. Opening times use Vietnam time. Capacity counts today's non-cancelled orders. Unclassified products and unconfigured facilities cannot receive new orders."
      />

      {invalidPolicies.length > 0 && <Alert type="warning" showIcon title="Some policies need a selling pharmacy update"
        description={`These facilities cannot accept new orders yet: ${invalidPolicies.map(p => p.facility_name).join(', ')}. A pharmacy must sell for itself; a warehouse must be linked to the selected selling pharmacy.`} />}

      <Card title="Facility delivery policy" className="shadow-xs rounded-lg">
        <Form
          form={form}
          layout="vertical"
          onFinish={save}
          initialValues={{ enabled: false }}
          className="grid grid-cols-1 gap-x-4 md:grid-cols-2 mb-6"
        >
          <Form.Item name="facilityId" label="Dispatch facility" rules={[{ required: true }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={facilities.filter(f => (isPharmacy(f) || isWarehouse(f)) && (superAdmin || f.id === facilityScope)).map(f => ({ value: f.id, label: f.name }))}
              onChange={id => {
                const p = policies.find(p => p.facility_id === id);
                form.resetFields();
                form.setFieldsValue({
                  facilityId: id,
                  ...(p
                    ? {
                        sellingFacilityId: p.selling_facility_id,
                        enabled: p.enabled,
                        opens: clock(p.opens_minute),
                        closes: clock(p.closes_minute),
                        weekdays: p.weekdays,
                        dailyCapacity: p.daily_capacity,
                        radiusKm: Number(p.radius_km),
                        transportConditions: p.transport_conditions,
                      }
                    : { enabled: false }),
                });
                const facility = facilities.find(f => f.id === id);
                form.setFieldValue('sellingFacilityId', facility && isPharmacy(facility) ? id
                  : warehouseLinks.some(link => link.warehouse_id === id && link.pharmacy_id === p?.selling_facility_id)
                    ? p?.selling_facility_id : undefined);
              }}
            />
          </Form.Item>
          <Form.Item name="sellingFacilityId" label="Selling pharmacy" rules={[{ required: true }]}
            extra={selectedFacility && isPharmacy(selectedFacility) ? 'A pharmacy sells for itself and is responsible for its own orders.'
              : 'A warehouse can only dispatch for linked pharmacies. A super admin manages the links below.'}>
            <Select
              showSearch
              optionFilterProp="label"
              disabled={!selectedFacility || isPharmacy(selectedFacility)}
              options={sellerOptions.map(f => ({ value: f.id, label: f.name }))}
              notFoundContent="This warehouse has no linked pharmacy"
            />
          </Form.Item>
          <Form.Item name="opens" label="Opens (HH:mm)" rules={[{ required: true }, { pattern: /^([01]\d|2[0-3]):[0-5]\d$/, message: 'Use HH:mm, from 00:00 to 23:59' }]}>
            <Input maxLength={5} />
          </Form.Item>
          <Form.Item name="closes" label="Closes (HH:mm, 24:00 supported)" rules={[{ required: true }, { pattern: /^(([01]\d|2[0-3]):[0-5]\d|24:00)$/, message: 'Use HH:mm, up to 24:00' }]}>
            <Input maxLength={5} />
          </Form.Item>
          <Form.Item name="weekdays" label="Operating days" rules={[{ required: true, type: 'array', min: 1 }]}>
            <Select mode="multiple" options={['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((label, value) => ({ label, value }))} />
          </Form.Item>
          <Form.Item name="dailyCapacity" label="Maximum orders per day" rules={[{ required: true }]}>
            <InputNumber min={1} max={1000000} precision={0} />
          </Form.Item>
          <Form.Item name="radiusKm" label="Delivery radius (km)" rules={[{ required: true }]}>
            <InputNumber min={0.01} max={3000} precision={2} />
          </Form.Item>
          <Form.Item name="transportConditions" label="Supported transport conditions" extra="Enter the exact approved classification labels used for medicines." rules={[{ required: true, type: 'array', min: 1 }]}>
            <Select mode="tags" maxCount={20} />
          </Form.Item>
          <Form.Item name="enabled" valuePropName="checked">
            <Checkbox>Accept new orders</Checkbox>
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={busy}>
              Save policy
            </Button>
          </Form.Item>
        </Form>

        <div className="border-t border-slate-100 pt-6">
          <h3 className="text-sm font-semibold text-slate-800 mb-3">Configured Policies ({policies.length})</h3>
          <Table
            size="small"
            rowKey="facility_id"
            scroll={{ x: 640 }}
            dataSource={policies}
            pagination={
              policies.length > 10
                ? {
                    pageSize: 10,
                    showSizeChanger: false,
                    placement: ['bottomEnd'],
                    itemRender: renderPaginationItem,
                  }
                : false
            }
            columns={[
              { title: 'Dispatch facility', dataIndex: 'facility_name' },
              { title: 'Selling pharmacy', dataIndex: 'selling_facility_name' },
              { title: 'Hours', render: (_, p) => `${clock(p.opens_minute)}–${clock(p.closes_minute)}` },
              { title: 'Capacity/day', dataIndex: 'daily_capacity' },
              { title: 'Status', render: (_, p) => (p.enabled ? 'Enabled' : 'Disabled') },
            ]}
          />
        </div>
      </Card>

      {superAdmin && <Card title="Warehouse – selling pharmacy links" className="shadow-xs rounded-lg">
        <Alert type="info" showIcon className="mb-4" title="Link only pharmacies allowed to sell from this warehouse"
          description="Removing a pharmacy from the list blocks new orders through that link. Orders already placed keep their recorded details." />
        <Form form={linkForm} layout="vertical" onFinish={saveLinks} initialValues={{ pharmacyIds: [] }}>
          <Form.Item name="warehouseId" label="Dispatch warehouse" rules={[{ required: true }]}>
            <Select showSearch optionFilterProp="label" options={facilities.filter(isWarehouse).map(f => ({ value: f.id, label: f.name }))}
              onChange={id => linkForm.setFieldValue('pharmacyIds', warehouseLinks.filter(l => l.warehouse_id === id).map(l => l.pharmacy_id))} />
          </Form.Item>
          <Form.Item name="pharmacyIds" label="Linked pharmacies" extra="Leave empty and save to remove every link for this warehouse.">
            <Select mode="multiple" allowClear optionFilterProp="label" options={facilities.filter(isPharmacy).map(f => ({ value: f.id, label: f.name }))} />
          </Form.Item>
          <Button htmlType="submit" type="primary" loading={busy}>Save links</Button>
        </Form>
      </Card>}

      <Card
        title="Medicine transport classification"
        className="shadow-xs rounded-lg"
        styles={{ header: { flexWrap: 'wrap', gap: 8, paddingBlock: 12 } }}
        extra={
          <Input.Search
            placeholder="Search medicine or condition..."
            allowClear
            value={reqSearch}
            onChange={e => setReqSearch(e.target.value)}
            className="w-full sm:w-64"
          />
        }
      >
        {superAdmin && (
          <Form
            form={requirementForm}
            layout="vertical"
            onFinish={saveRequirement}
            className="mb-6"
            style={{ marginBottom: 24 }}
          >
            <Form.Item name="medicineId" label="Medicine ID" rules={[{ required: true }]}>
              <InputNumber min={1} precision={0} />
            </Form.Item>
            <Form.Item name="condition" label="Approved transport condition" rules={[{ required: true, whitespace: true }]}>
              <Input maxLength={100} />
            </Form.Item>
            <Button htmlType="submit" loading={busy}>
              Save classification
            </Button>
          </Form>
        )}

        <Table
          size="small"
          rowKey="medicine_id"
          scroll={{ x: 520 }}
          dataSource={requirements.filter(r => {
            if (!reqSearch.trim()) return true;
            const q = reqSearch.toLowerCase().trim();
            return (
              String(r.medicine_id).includes(q) ||
              (r.medicine_name && r.medicine_name.toLowerCase().includes(q)) ||
              (r.condition && r.condition.toLowerCase().includes(q))
            );
          })}
          columns={[
            { title: 'Medicine ID', dataIndex: 'medicine_id', width: 120 },
            { title: 'Medicine', dataIndex: 'medicine_name' },
            { title: 'Transport condition', dataIndex: 'condition' },
          ]}
          pagination={{
            pageSize: 10,
            showSizeChanger: false,
            placement: ['bottomEnd'],
            itemRender: renderPaginationItem,
          }}
        />
      </Card>
    </div>
  );
}
