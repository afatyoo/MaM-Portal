import React, { useEffect, useState } from 'react';
import {
  Modal,
  Form,
  Input,
  Select,
  Switch,
  Button,
  Space,
  Typography,
  Alert,
  message,
  Divider,
} from 'antd';
import {
  CloudServerOutlined,
  SafetyCertificateOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import api from '@/api/axios';
import type { ZimbraServer, ZimbraServerFormData } from '@/types/admin';

const { Text } = Typography;

interface ServerFormModalProps {
  open: boolean;
  editingServer: ZimbraServer | null;
  onCancel: () => void;
  onSuccess: () => void;
}

const ServerFormModal: React.FC<ServerFormModalProps> = ({
  open,
  editingServer,
  onCancel,
  onSuccess,
}) => {
  const [form] = Form.useForm<ZimbraServerFormData>();
  const [submitting, setSubmitting] = useState(false);
  const isEditing = !!editingServer;

  useEffect(() => {
    if (open) {
      if (editingServer) {
        form.setFieldsValue({
          key: editingServer.key,
          name: editingServer.name,
          server: editingServer.server,
          domains: editingServer.domains,
          preauthkey: '',
          soap_path: editingServer.soap_path,
          preauth_path: editingServer.preauth_path,
          ca_file: editingServer.ca_file || '',
          insecure_tls: editingServer.insecure_tls,
        });
      } else {
        form.resetFields();
        form.setFieldsValue({
          soap_path: '/service/soap',
          preauth_path: '/service/preauth',
          insecure_tls: false,
        });
      }
    }
  }, [open, editingServer, form]);

  const handleSubmit = async (values: ZimbraServerFormData) => {
    setSubmitting(true);
    try {
      const payload = {
        ...values,
        domains: values.domains.map((d) => d.toLowerCase().trim()),
      };

      if (isEditing) {
        await api.put(`/api/admin/zimbra-servers/${editingServer.key}`, payload);
        message.success('Server updated successfully');
      } else {
        await api.post('/api/admin/zimbra-servers', payload);
        message.success('Server created successfully');
      }
      onSuccess();
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Failed to save server');
    } finally {
      setSubmitting(false);
    }
  };

  const validateHttpsUrl = (_: unknown, value: string) => {
    if (!value) return Promise.reject('Server URL is required');
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:') {
        return Promise.reject('URL must use HTTPS protocol');
      }
      return Promise.resolve();
    } catch {
      return Promise.reject('Invalid URL format');
    }
  };

  const validatePath = (_: unknown, value: string) => {
    if (!value) return Promise.reject('Path is required');
    if (!value.startsWith('/')) {
      return Promise.reject('Path must start with /');
    }
    return Promise.resolve();
  };

  return (
    <Modal
      title={
        <Space>
          <CloudServerOutlined />
          {isEditing ? 'Edit Zimbra Server' : 'Add Zimbra Server'}
        </Space>
      }
      open={open}
      onCancel={onCancel}
      width={600}
      footer={null}
      destroyOnClose
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={handleSubmit}
        autoComplete="off"
      >
        <Form.Item
          name="key"
          label="Server Key"
          rules={[
            { required: true, message: 'Server key is required' },
            {
              pattern: /^MaMKey_\d+$/,
              message: 'Key must match format: MaMKey_<number> (e.g., MaMKey_1)',
            },
          ]}
          extra="Unique identifier in format MaMKey_1, MaMKey_2, etc."
        >
          <Input
            placeholder="MaMKey_1"
            disabled={isEditing}
            style={{ fontFamily: 'monospace' }}
          />
        </Form.Item>

        <Form.Item
          name="name"
          label="Display Name"
          rules={[{ required: true, message: 'Display name is required' }]}
        >
          <Input placeholder="Zimbra/Carbonio Server" />
        </Form.Item>

        <Form.Item
          name="server"
          label="Server URL"
          rules={[{ required: true, validator: validateHttpsUrl }]}
          extra="HTTPS URL of the Zimbra/Carbonio server"
        >
          <Input placeholder="https://mail.example.com" />
        </Form.Item>

        <Form.Item
          name="domains"
          label="Domains"
          rules={[
            { required: true, message: 'At least one domain is required' },
            {
              validator: (_, value) =>
                value && value.length > 0
                  ? Promise.resolve()
                  : Promise.reject('At least one domain is required'),
            },
          ]}
          extra="Email domains handled by this server (press Enter to add)"
        >
          <Select
            mode="tags"
            placeholder="example.com"
            tokenSeparators={[',', ' ', '\n']}
            style={{ width: '100%' }}
          />
        </Form.Item>

        <Divider />

        <Form.Item
          name="preauthkey"
          label="Preauth Key"
          rules={[
            {
              required: !isEditing,
              message: 'Preauth key is required for new servers',
            },
          ]}
          extra={
            isEditing ? (
              <Text type="secondary">
                Leave empty to keep the existing key. Current key: {editingServer?.preauthkey_masked || '********'}
              </Text>
            ) : (
              'Zimbra/Carbonio domain preauth key'
            )
          }
        >
          <Input.Password
            placeholder={isEditing ? 'Leave empty to keep existing' : 'Enter preauth key'}
          />
        </Form.Item>

        <Space style={{ width: '100%' }} size="middle">
          <Form.Item
            name="soap_path"
            label="SOAP Path"
            rules={[{ required: true, validator: validatePath }]}
            style={{ flex: 1, marginBottom: 0 }}
          >
            <Input placeholder="/service/soap" style={{ fontFamily: 'monospace' }} />
          </Form.Item>

          <Form.Item
            name="preauth_path"
            label="Preauth Path"
            rules={[{ required: true, validator: validatePath }]}
            style={{ flex: 1, marginBottom: 0 }}
          >
            <Input placeholder="/service/preauth" style={{ fontFamily: 'monospace' }} />
          </Form.Item>
        </Space>

        <div style={{ height: 24 }} />

        <Form.Item
          name="ca_file"
          label="CA Certificate File"
          extra="Path to custom CA certificate (optional)"
        >
          <Input
            placeholder="certs/internal-ca.pem"
            prefix={<SafetyCertificateOutlined style={{ color: '#52c41a' }} />}
            style={{ fontFamily: 'monospace' }}
          />
        </Form.Item>

        <Form.Item
          name="insecure_tls"
          label="Insecure TLS"
          valuePropName="checked"
        >
          <Switch />
        </Form.Item>

        <Form.Item noStyle shouldUpdate={(prev, curr) => prev.insecure_tls !== curr.insecure_tls}>
          {({ getFieldValue }) =>
            getFieldValue('insecure_tls') && (
              <Alert
                type="warning"
                icon={<WarningOutlined />}
                message="Security Warning"
                description="Insecure TLS skips certificate verification. Only use for testing environments, never in production!"
                showIcon
                style={{ marginBottom: 24 }}
              />
            )
          }
        </Form.Item>

        <Divider />

        <Form.Item style={{ marginBottom: 0 }}>
          <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
            <Button onClick={onCancel} disabled={submitting}>
              Cancel
            </Button>
            <Button type="primary" htmlType="submit" loading={submitting}>
              {isEditing ? 'Update Server' : 'Add Server'}
            </Button>
          </Space>
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default ServerFormModal;
