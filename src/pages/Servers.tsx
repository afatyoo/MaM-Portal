import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Table,
  Button,
  Card,
  Space,
  Typography,
  Tag,
  Input,
  Modal,
  message,
  Tooltip,
  theme,
  Popconfirm,
} from 'antd';
import {
  ReloadOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  SearchOutlined,
  ExclamationCircleOutlined,
  ApiOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import api from '@/api/axios';
import type { ZimbraServer, TestConnectionResult } from '@/types/admin';
import ServerFormModal from '@/components/ServerFormModal';
import TestConnectionModal from '@/components/TestConnectionModal';

const { Title, Text } = Typography;

const Servers: React.FC = () => {
  const [servers, setServers] = useState<ZimbraServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchDomain, setSearchDomain] = useState('');
  const [searchServer, setSearchServer] = useState('');
  const [formModalOpen, setFormModalOpen] = useState(false);
  const [editingServer, setEditingServer] = useState<ZimbraServer | null>(null);
  const [testModalOpen, setTestModalOpen] = useState(false);
  const [testingServer, setTestingServer] = useState<ZimbraServer | null>(null);
  const { token } = theme.useToken();

  const fetchServers = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get('/api/admin/zimbra-servers');
      setServers(response.data.servers || []);
    } catch (error) {
      message.error('Failed to load servers');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchServers();
  }, [fetchServers]);

  const filteredServers = useMemo(() => {
    return servers.filter((server) => {
      const domainMatch = searchDomain
        ? server.domains.some((d) => d.toLowerCase().includes(searchDomain.toLowerCase()))
        : true;
      const serverMatch = searchServer
        ? server.server.toLowerCase().includes(searchServer.toLowerCase())
        : true;
      return domainMatch && serverMatch;
    });
  }, [servers, searchDomain, searchServer]);

  const handleAdd = () => {
    setEditingServer(null);
    setFormModalOpen(true);
  };

  const handleEdit = (server: ZimbraServer) => {
    setEditingServer(server);
    setFormModalOpen(true);
  };

  const handleDelete = async (key: string) => {
    try {
      await api.delete(`/api/admin/zimbra-servers/${key}`);
      message.success('Server deleted successfully');
      fetchServers();
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Failed to delete server');
    }
  };

  const handleTest = (server: ZimbraServer) => {
    setTestingServer(server);
    setTestModalOpen(true);
  };

  const handleFormSuccess = () => {
    setFormModalOpen(false);
    setEditingServer(null);
    fetchServers();
  };

  const columns: ColumnsType<ZimbraServer> = [
    {
      title: 'Key',
      dataIndex: 'key',
      key: 'key',
      width: 120,
      sorter: (a, b) => a.key.localeCompare(b.key),
      defaultSortOrder: 'ascend',
      render: (value: string) => (
        <Text strong style={{ fontFamily: 'monospace' }}>{value}</Text>
      ),
    },
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      width: 150,
    },
    {
      title: 'Server URL',
      dataIndex: 'server',
      key: 'server',
      width: 220,
      ellipsis: true,
      render: (value: string) => (
        <Tooltip title={value}>
          <Text copyable={{ text: value }} style={{ fontFamily: 'monospace', fontSize: 12 }}>
            {value}
          </Text>
        </Tooltip>
      ),
    },
    {
      title: 'Domains',
      dataIndex: 'domains',
      key: 'domains',
      width: 200,
      render: (domains: string[]) => (
        <Space size={[0, 4]} wrap>
          {domains.slice(0, 3).map((domain) => (
            <Tag key={domain} color="blue">{domain}</Tag>
          ))}
          {domains.length > 3 && (
            <Tooltip title={domains.slice(3).join(', ')}>
              <Tag>+{domains.length - 3} more</Tag>
            </Tooltip>
          )}
        </Space>
      ),
    },
    {
      title: 'SOAP Path',
      dataIndex: 'soap_path',
      key: 'soap_path',
      width: 130,
      render: (value: string) => (
        <Text type="secondary" style={{ fontFamily: 'monospace', fontSize: 11 }}>{value}</Text>
      ),
    },
    {
      title: 'Preauth Path',
      dataIndex: 'preauth_path',
      key: 'preauth_path',
      width: 130,
      render: (value: string) => (
        <Text type="secondary" style={{ fontFamily: 'monospace', fontSize: 11 }}>{value}</Text>
      ),
    },
    {
      title: 'CA File',
      dataIndex: 'ca_file',
      key: 'ca_file',
      width: 150,
      render: (value: string) => value ? (
        <Tooltip title={value}>
          <Tag icon={<SafetyCertificateOutlined />} color="green">
            {value.split('/').pop()}
          </Tag>
        </Tooltip>
      ) : (
        <Text type="secondary">-</Text>
      ),
    },
    {
      title: 'Insecure TLS',
      dataIndex: 'insecure_tls',
      key: 'insecure_tls',
      width: 100,
      align: 'center',
      render: (value: boolean) => (
        <Tag color={value ? 'warning' : 'success'}>
          {value ? 'Yes' : 'No'}
        </Tag>
      ),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 150,
      fixed: 'right',
      render: (_, record) => (
        <Space size="small">
          <Tooltip title="Test Connection">
            <Button
              type="text"
              size="small"
              icon={<ApiOutlined />}
              onClick={() => handleTest(record)}
            />
          </Tooltip>
          <Tooltip title="Edit">
            <Button
              type="text"
              size="small"
              icon={<EditOutlined />}
              onClick={() => handleEdit(record)}
            />
          </Tooltip>
          <Popconfirm
            title="Delete Server"
            description={
              <span>
                Are you sure you want to delete <strong>{record.key}</strong>?
                <br />
                This will remove the domain mappings.
              </span>
            }
            onConfirm={() => handleDelete(record.key)}
            okText="Delete"
            cancelText="Cancel"
            okButtonProps={{ danger: true }}
            icon={<ExclamationCircleOutlined style={{ color: token.colorError }} />}
          >
            <Tooltip title="Delete">
              <Button
                type="text"
                size="small"
                danger
                icon={<DeleteOutlined />}
              />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <Title level={4} style={{ margin: 0 }}> Server Management</Title>
          <Text type="secondary">Manage server mappings and domain configurations</Text>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={fetchServers} loading={loading}>
            Refresh
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
            Add Server
          </Button>
        </Space>
      </div>

      {/* Security Notice */}
      <Card 
        size="small" 
        style={{ marginBottom: 16, background: token.colorWarningBg, border: `1px solid ${token.colorWarningBorder}` }}
        styles={{ body: { padding: '8px 16px' } }}
      >
        <Space>
          <SafetyCertificateOutlined style={{ color: token.colorWarning }} />
          <Text type="secondary" style={{ fontSize: 13 }}>
            <strong>Security Note:</strong> Preauth keys are never displayed. When editing, leave the preauthkey field empty to keep the existing key.
          </Text>
        </Space>
      </Card>

      {/* Filters */}
      <Card style={{ marginBottom: 16 }} styles={{ body: { padding: 16 } }}>
        <Space size="middle" wrap>
          <Space direction="vertical" size={4}>
            <Text type="secondary" style={{ fontSize: 12 }}>Search by Domain</Text>
            <Input
              placeholder="Enter domain..."
              prefix={<SearchOutlined style={{ color: token.colorTextSecondary }} />}
              value={searchDomain}
              onChange={(e) => setSearchDomain(e.target.value)}
              allowClear
              style={{ width: 200 }}
            />
          </Space>
          <Space direction="vertical" size={4}>
            <Text type="secondary" style={{ fontSize: 12 }}>Search by Server URL</Text>
            <Input
              placeholder="Enter server URL..."
              prefix={<SearchOutlined style={{ color: token.colorTextSecondary }} />}
              value={searchServer}
              onChange={(e) => setSearchServer(e.target.value)}
              allowClear
              style={{ width: 250 }}
            />
          </Space>
        </Space>
      </Card>

      {/* Table */}
      <Card styles={{ body: { padding: 0 } }}>
        <Table
          columns={columns}
          dataSource={filteredServers}
          rowKey="key"
          loading={loading}
          scroll={{ x: 1400 }}
          pagination={{
            pageSize: 10,
            showSizeChanger: true,
            showTotal: (total) => `${total} server(s)`,
          }}
          locale={{
            emptyText: 'No servers configured yet. Click "Add Server" to create one.',
          }}
        />
      </Card>

      {/* Form Modal */}
      <ServerFormModal
        open={formModalOpen}
        editingServer={editingServer}
        onCancel={() => {
          setFormModalOpen(false);
          setEditingServer(null);
        }}
        onSuccess={handleFormSuccess}
      />

      {/* Test Connection Modal */}
      <TestConnectionModal
        open={testModalOpen}
        server={testingServer}
        onClose={() => {
          setTestModalOpen(false);
          setTestingServer(null);
        }}
      />
    </div>
  );
};

export default Servers;
