import React, { useCallback, useEffect, useState } from 'react';
import {
  App as AntApp,
  Badge,
  Button,
  Card,
  Col,
  Descriptions,
  Row,
  Space,
  Statistic,
  Switch,
  Table,
  Tag,
  Typography,
  theme,
} from 'antd';
import { ClearOutlined, ReloadOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import api from '@/api/axios';
import type { MailListener, MailStatus } from '@/types/admin';

const { Title, Text } = Typography;

const LIMIT_LABELS: Record<string, string> = {
  max_conn_per_ip: 'Max connections per IP',
  max_conn_total: 'Max connections total',
  prelogin_timeout_sec: 'Pre-login timeout (s)',
  idle_timeout_sec: 'Idle timeout (s)',
  backend_timeout_sec: 'Backend timeout (s)',
  handshake_timeout_sec: 'TLS handshake timeout (s)',
  auth_fail_per_ip: 'Failed logins per IP',
  auth_fail_per_user: 'Failed logins per user',
  auth_fail_window_sec: 'Failure window (s)',
  send_originating_ip: 'Send originating IP',
};

const PROTOCOL_LABELS: Record<string, string> = {
  imaps: 'IMAPS',
  pop3s: 'POP3S',
  smtps: 'SMTPS',
};

const formatDuration = (from: string | null): string => {
  if (!from) return '-';
  const ms = Date.now() - new Date(from).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '-';
  const totalMinutes = Math.floor(ms / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
};

const MailProxy: React.FC = () => {
  const [status, setStatus] = useState<MailStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const { message } = AntApp.useApp();
  const { token } = theme.useToken();

  const fetchStatus = useCallback(async () => {
    try {
      const response = await api.get('/api/admin/mail/status');
      setStatus(response.data as MailStatus);
    } catch (error) {
      console.error('Failed to fetch mail status:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(fetchStatus, 10000);
    return () => clearInterval(id);
  }, [autoRefresh, fetchStatus]);

  const clearCache = async () => {
    try {
      const res = await api.delete('/api/admin/mail/cache');
      message.success(`${res.data?.removed ?? 0} cached entries removed`);
      fetchStatus();
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const listeners = status?.listeners ?? [];
  const cache = status?.cache ?? null;
  const activeListeners = listeners.filter((l) => l.listening).length;

  const columns: ColumnsType<MailListener> = [
    {
      title: 'Service',
      dataIndex: 'name',
      key: 'name',
      width: 120,
      render: (value: string) => <Text strong>{PROTOCOL_LABELS[value] ?? value.toUpperCase()}</Text>,
    },
    {
      title: 'Port',
      dataIndex: 'port',
      key: 'port',
      width: 100,
    },
    {
      title: 'State',
      key: 'state',
      width: 140,
      render: (_, record) =>
        record.listening ? (
          <Badge status="success" text="Listening" />
        ) : (
          <Badge status="error" text="Down" />
        ),
    },
    {
      title: 'Error',
      dataIndex: 'error',
      key: 'error',
      ellipsis: true,
      render: (value: string) => value || <Text type="secondary">-</Text>,
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>
            Mail Proxy
          </Title>
          <Text type="secondary">{status?.hostname || 'not reported'}</Text>
        </div>
        <Space>
          <Space size={6}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Auto refresh
            </Text>
            <Switch size="small" checked={autoRefresh} onChange={setAutoRefresh} />
          </Space>
          <Button icon={<ReloadOutlined />} onClick={fetchStatus} loading={loading}>
            Refresh
          </Button>
        </Space>
      </div>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={12} md={6}>
          <Card>
            <Statistic
              title="Proxy"
              value={status?.enabled ? 'Enabled' : 'Disabled'}
              valueStyle={{ color: status?.enabled ? token.colorSuccess : token.colorTextSecondary }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card>
            <Statistic title="Listeners up" value={`${activeListeners}/${listeners.length}`} />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card>
            <Statistic title="Open connections" value={status?.connections ?? 0} />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card>
            <Statistic title="Uptime" value={formatDuration(status?.started_at ?? null)} />
          </Card>
        </Col>
      </Row>

      <Card title="Listeners" style={{ marginBottom: 16 }} styles={{ body: { padding: 0 } }}>
        <Table
          columns={columns}
          dataSource={listeners}
          rowKey={(record) => record.name}
          pagination={false}
          size="small"
          locale={{ emptyText: 'Mail proxy is disabled in config.ini' }}
        />
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={14}>
          <Card title="Routing cache" style={{ marginBottom: 16 }}>
            {cache?.enabled ? (
              <>
                <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
                  <Col span={8}>
                    <Statistic title="Entries" value={cache.entries} />
                  </Col>
                  <Col span={8}>
                    <Statistic title="Hit rate" value={cache.hit_rate} suffix="%" />
                  </Col>
                  <Col span={8}>
                    <Statistic title="Hits" value={cache.hits} />
                  </Col>
                </Row>
                <Descriptions size="small" column={1} bordered>
                  <Descriptions.Item label="File">
                    <Text code>{cache.file}</Text>
                  </Descriptions.Item>
                  <Descriptions.Item label="TTL">{cache.ttl_days ? `${cache.ttl_days} days` : 'never expires'}</Descriptions.Item>
                  <Descriptions.Item label="Max entries">{cache.max_entries || 'unlimited'}</Descriptions.Item>
                  <Descriptions.Item label="Misses">{cache.misses}</Descriptions.Item>
                  <Descriptions.Item label="Evicted">{cache.dropped}</Descriptions.Item>
                  <Descriptions.Item label="Last saved">{cache.last_saved_at || '-'}</Descriptions.Item>
                </Descriptions>
                <Space style={{ marginTop: 16 }}>
                  <Button danger icon={<ClearOutlined />} onClick={clearCache}>
                    Clear cache
                  </Button>
                  {cache.error && <Tag color="error">{cache.error}</Tag>}
                </Space>
              </>
            ) : (
              <Text type="secondary">
                Cache is disabled. Set <Text code>route_cache_enabled = true</Text> in the [MAIL] section to make logins
                on a domain that lives on two servers skip the slow fallback.
              </Text>
            )}
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card title="Limits">
            <Descriptions size="small" column={1} bordered>
              {Object.entries(status?.limits ?? {})
                .filter(([key]) => key in LIMIT_LABELS)
                .map(([key, value]) => (
                  <Descriptions.Item key={key} label={LIMIT_LABELS[key]}>
                    {typeof value === 'boolean' ? (value ? 'yes' : 'no') : String(value)}
                  </Descriptions.Item>
                ))}
            </Descriptions>
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default MailProxy;
