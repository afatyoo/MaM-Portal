import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Table, Tag, Button, Select, Input, Card, Space, Typography, Row, Col, theme } from 'antd';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import type { ColumnsType, TablePaginationConfig } from 'antd/es/table';
import api from '@/api/axios';
import type { LogEntry } from '@/types/admin';

const { Title } = Typography;
const { Option } = Select;

const Logs: React.FC = () => {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [limit, setLimit] = useState(200);
  const [resultFilter, setResultFilter] = useState<'all' | 'ok' | 'fail'>('all');
  const [serverFilter, setServerFilter] = useState<string>('all');
  const [domainSearch, setDomainSearch] = useState('');
  const { token } = theme.useToken();

  const fetchLogs = useCallback(async (logLimit: number) => {
    setLoading(true);
    try {
      const response = await api.get(`/api/admin/logs?limit=${logLimit}`);
      setEntries(response.data.entries || []);
    } catch (error) {
      console.error('Failed to fetch logs:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLogs(limit);
  }, [fetchLogs, limit]);

  const uniqueServers = useMemo(() => {
    const servers = new Set(entries.map((e) => e.server_key));
    return Array.from(servers).sort();
  }, [entries]);

  const filteredEntries = useMemo(() => {
    return entries.filter((entry) => {
      if (resultFilter !== 'all' && entry.result !== resultFilter) return false;
      if (serverFilter !== 'all' && entry.server_key !== serverFilter) return false;
      if (domainSearch && !entry.domain.toLowerCase().includes(domainSearch.toLowerCase())) return false;
      return true;
    });
  }, [entries, resultFilter, serverFilter, domainSearch]);

  const handleLimitChange = (value: number) => {
    setLimit(value);
  };

  const columns: ColumnsType<LogEntry> = [
    {
      title: 'Timestamp',
      dataIndex: 'timestamp',
      key: 'timestamp',
      width: 180,
      sorter: (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      defaultSortOrder: 'descend',
      render: (value: string) => {
        const date = new Date(value);
        return date.toLocaleString('id-ID', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        });
      },
    },
    {
      title: 'Email',
      dataIndex: 'email',
      key: 'email',
      width: 220,
      ellipsis: true,
    },
    {
      title: 'Domain',
      dataIndex: 'domain',
      key: 'domain',
      width: 150,
      ellipsis: true,
    },
    {
      title: 'Server',
      dataIndex: 'server_key',
      key: 'server_key',
      width: 120,
    },
    {
      title: 'Result',
      dataIndex: 'result',
      key: 'result',
      width: 80,
      render: (value: 'ok' | 'fail') => (
        <Tag color={value === 'ok' ? 'success' : 'error'}>
          {value.toUpperCase()}
        </Tag>
      ),
    },
    {
      title: 'IP',
      dataIndex: 'ip',
      key: 'ip',
      width: 130,
    },
    {
      title: 'Time (ms)',
      dataIndex: 'ms',
      key: 'ms',
      width: 100,
      align: 'right',
      sorter: (a, b) => a.ms - b.ms,
      render: (value: number) => (
        <span style={{ 
          color: value > 1000 ? token.colorWarning : value > 500 ? token.colorTextSecondary : token.colorSuccess,
          fontWeight: 500
        }}>
          {value}
        </span>
      ),
    },
  ];

  const pagination: TablePaginationConfig = {
    pageSize: 50,
    showSizeChanger: true,
    pageSizeOptions: ['20', '50', '100'],
    showTotal: (total, range) => `${range[0]}-${range[1]} of ${total} entries`,
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <Title level={4} style={{ margin: 0 }}>Authentication Logs</Title>
        <Button
          icon={<ReloadOutlined />}
          onClick={() => fetchLogs(limit)}
          loading={loading}
        >
          Refresh
        </Button>
      </div>

      <Card style={{ marginBottom: 16 }} styles={{ body: { padding: 16 } }}>
        <Row gutter={[16, 16]} align="middle">
          <Col xs={24} sm={12} md={6}>
            <Space direction="vertical" size={4} style={{ width: '100%' }}>
              <span style={{ color: token.colorTextSecondary, fontSize: 12 }}>Result</span>
              <Select
                value={resultFilter}
                onChange={(value) => setResultFilter(value)}
                style={{ width: '100%' }}
              >
                <Option value="all">All Results</Option>
                <Option value="ok">Success Only</Option>
                <Option value="fail">Failed Only</Option>
              </Select>
            </Space>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Space direction="vertical" size={4} style={{ width: '100%' }}>
              <span style={{ color: token.colorTextSecondary, fontSize: 12 }}>Server</span>
              <Select
                value={serverFilter}
                onChange={(value) => setServerFilter(value)}
                style={{ width: '100%' }}
              >
                <Option value="all">All Servers</Option>
                {uniqueServers.map((server) => (
                  <Option key={server} value={server}>{server}</Option>
                ))}
              </Select>
            </Space>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Space direction="vertical" size={4} style={{ width: '100%' }}>
              <span style={{ color: token.colorTextSecondary, fontSize: 12 }}>Domain Search</span>
              <Input
                placeholder="Search domain..."
                prefix={<SearchOutlined style={{ color: token.colorTextSecondary }} />}
                value={domainSearch}
                onChange={(e) => setDomainSearch(e.target.value)}
                allowClear
              />
            </Space>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Space direction="vertical" size={4} style={{ width: '100%' }}>
              <span style={{ color: token.colorTextSecondary, fontSize: 12 }}>Limit</span>
              <Select
                value={limit}
                onChange={handleLimitChange}
                style={{ width: '100%' }}
              >
                <Option value={200}>200 entries</Option>
                <Option value={500}>500 entries</Option>
                <Option value={1000}>1000 entries</Option>
              </Select>
            </Space>
          </Col>
        </Row>
      </Card>

      <Card styles={{ body: { padding: 0 } }}>
        <Table
          columns={columns}
          dataSource={filteredEntries}
          rowKey={(record) => `${record.timestamp}-${record.email}-${record.ip}`}
          loading={loading}
          pagination={pagination}
          scroll={{ x: 1000 }}
          size="small"
          locale={{
            emptyText: 'No logs found matching the filters',
          }}
        />
      </Card>
    </div>
  );
};

export default Logs;
