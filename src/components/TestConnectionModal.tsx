import React, { useState } from 'react';
import {
  Modal,
  Form,
  Input,
  Button,
  Space,
  Typography,
  Alert,
  Spin,
  Divider,
  Descriptions,
  Tag,
  Tabs,
} from 'antd';
import {
  ApiOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
  SafetyCertificateOutlined,
  CloudOutlined,
} from '@ant-design/icons';
import api from '@/api/axios';
import type { ZimbraServer, TestConnectionResult } from '@/types/admin';

const { Text, Title } = Typography;

interface TestConnectionModalProps {
  open: boolean;
  server: ZimbraServer | null;
  onClose: () => void;
}

interface AdvancedTestForm {
  test_email: string;
  test_password: string;
}

const TestConnectionModal: React.FC<TestConnectionModalProps> = ({
  open,
  server,
  onClose,
}) => {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestConnectionResult | null>(null);
  const [activeTab, setActiveTab] = useState('quick');
  const [form] = Form.useForm<AdvancedTestForm>();

  const handleQuickTest = async () => {
    if (!server) return;
    
    setTesting(true);
    setResult(null);
    
    try {
      const response = await api.post(`/api/admin/zimbra-servers/${server.key}/test`);
      setResult(response.data);
    } catch (error) {
      setResult({
        ok: false,
        error: error instanceof Error ? error.message : 'Connection test failed',
      });
    } finally {
      setTesting(false);
    }
  };

  const handleAdvancedTest = async (values: AdvancedTestForm) => {
    if (!server) return;
    
    setTesting(true);
    setResult(null);
    
    try {
      const response = await api.post(`/api/admin/zimbra-servers/${server.key}/test`, values);
      setResult(response.data);
    } catch (error) {
      setResult({
        ok: false,
        error: error instanceof Error ? error.message : 'Connection test failed',
      });
    } finally {
      setTesting(false);
    }
  };

  const handleClose = () => {
    setResult(null);
    setActiveTab('quick');
    form.resetFields();
    onClose();
  };

  if (!server) return null;

  return (
    <Modal
      title={
        <Space>
          <ApiOutlined />
          Test Connection - {server.key}
        </Space>
      }
      open={open}
      onCancel={handleClose}
      width={550}
      footer={null}
      destroyOnClose
    >
      <div style={{ marginBottom: 16 }}>
        <Descriptions size="small" column={1} bordered>
          <Descriptions.Item label="Server">{server.server}</Descriptions.Item>
          <Descriptions.Item label="Name">{server.name}</Descriptions.Item>
          <Descriptions.Item label="Domains">
            <Space wrap>
              {server.domains.map((d) => (
                <Tag key={d} color="blue">{d}</Tag>
              ))}
            </Space>
          </Descriptions.Item>
        </Descriptions>
      </div>

      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: 'quick',
            label: (
              <Space>
                <CloudOutlined />
                Quick Test
              </Space>
            ),
            children: (
              <div>
                <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
                  Quick test verifies SOAP endpoint connectivity and TLS handshake without authentication.
                </Text>
                <Button
                  type="primary"
                  icon={testing ? <LoadingOutlined /> : <ApiOutlined />}
                  onClick={handleQuickTest}
                  loading={testing}
                  block
                >
                  Run Quick Test
                </Button>
              </div>
            ),
          },
          {
            key: 'advanced',
            label: (
              <Space>
                <SafetyCertificateOutlined />
                Advanced Test
              </Space>
            ),
            children: (
              <div>
                <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
                  Advanced test performs a full authentication request with provided credentials.
                </Text>
                <Form form={form} layout="vertical" onFinish={handleAdvancedTest}>
                  <Form.Item
                    name="test_email"
                    label="Test Email"
                    rules={[
                      { required: true, message: 'Email is required' },
                      { type: 'email', message: 'Invalid email format' },
                    ]}
                  >
                    <Input placeholder="user@example.com" />
                  </Form.Item>
                  <Form.Item
                    name="test_password"
                    label="Test Password"
                    rules={[{ required: true, message: 'Password is required' }]}
                  >
                    <Input.Password placeholder="Enter password" />
                  </Form.Item>
                  <Form.Item style={{ marginBottom: 0 }}>
                    <Button
                      type="primary"
                      htmlType="submit"
                      icon={testing ? <LoadingOutlined /> : <ApiOutlined />}
                      loading={testing}
                      block
                    >
                      Run Authentication Test
                    </Button>
                  </Form.Item>
                </Form>
              </div>
            ),
          },
        ]}
      />

      {testing && (
        <div style={{ textAlign: 'center', padding: 24 }}>
          <Spin size="large" />
          <div style={{ marginTop: 12 }}>
            <Text type="secondary">Testing connection...</Text>
          </div>
        </div>
      )}

      {result && !testing && (
        <>
          <Divider />
          <Title level={5} style={{ marginBottom: 12 }}>Test Result</Title>
          
          {result.ok ? (
            <Alert
              type="success"
              icon={<CheckCircleOutlined />}
              message="Connection Successful"
              description={
                result.details && (
                  <Descriptions size="small" column={1} style={{ marginTop: 8 }}>
                    <Descriptions.Item label="SOAP">
                      <Tag color="success">{result.details.soap}</Tag>
                    </Descriptions.Item>
                    <Descriptions.Item label="TLS">
                      <Tag color="success">{result.details.tls}</Tag>
                    </Descriptions.Item>
                    <Descriptions.Item label="Status Code">
                      <Tag color="blue">{result.details.status}</Tag>
                    </Descriptions.Item>
                  </Descriptions>
                )
              }
              showIcon
            />
          ) : (
            <Alert
              type="error"
              icon={<CloseCircleOutlined />}
              message="Connection Failed"
              description={result.error || 'Unknown error occurred'}
              showIcon
            />
          )}
        </>
      )}
    </Modal>
  );
};

export default TestConnectionModal;
