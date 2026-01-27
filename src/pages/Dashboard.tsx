import React, { useState, useEffect, useCallback } from 'react';
import { Row, Col, Card, Statistic, Button, Spin, Empty, Typography, theme } from 'antd';
import { 
  ReloadOutlined, 
  CheckCircleOutlined, 
  CloseCircleOutlined,
  BarChartOutlined,
  ClockCircleOutlined 
} from '@ant-design/icons';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import api from '@/api/axios';
import type { Stats } from '@/types/admin';

const { Title } = Typography;

const Dashboard: React.FC = () => {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const { token } = theme.useToken();

  const fetchStats = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get('/api/admin/stats');
      setStats(response.data.stats);
    } catch (error) {
      console.error('Failed to fetch stats:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const convertToChartData = (data: Record<string, number>) => {
    return Object.entries(data).map(([name, value]) => ({ name, value }));
  };

  const COLORS = ['#1890ff', '#52c41a', '#faad14', '#eb2f96', '#722ed1', '#13c2c2', '#fa541c', '#2f54eb'];

  if (loading && !stats) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!stats) {
    return <Empty description="Failed to load statistics" />;
  }

  const serverData = convertToChartData(stats.byServer);
  const domainData = convertToChartData(stats.byDomain);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <Title level={4} style={{ margin: 0 }}>Dashboard Overview</Title>
        <Button 
          icon={<ReloadOutlined />} 
          onClick={fetchStats} 
          loading={loading}
        >
          Refresh
        </Button>
      </div>

      {/* All Time Stats */}
      <Title level={5} style={{ marginBottom: 16, color: token.colorTextSecondary }}>
        <BarChartOutlined style={{ marginRight: 8 }} />
        All Time Statistics
      </Title>
      <Row gutter={[16, 16]} style={{ marginBottom: 32 }}>
        <Col xs={24} sm={8}>
          <Card styles={{ body: { padding: '20px 24px' } }}>
            <Statistic
              title="Total Attempts"
              value={stats.total}
              valueStyle={{ color: token.colorPrimary, fontSize: 28 }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card styles={{ body: { padding: '20px 24px' } }}>
            <Statistic
              title="Successful"
              value={stats.ok}
              valueStyle={{ color: '#52c41a', fontSize: 28 }}
              prefix={<CheckCircleOutlined />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card styles={{ body: { padding: '20px 24px' } }}>
            <Statistic
              title="Failed"
              value={stats.fail}
              valueStyle={{ color: '#ff4d4f', fontSize: 28 }}
              prefix={<CloseCircleOutlined />}
            />
          </Card>
        </Col>
      </Row>

      {/* Last 24h Stats */}
      <Title level={5} style={{ marginBottom: 16, color: token.colorTextSecondary }}>
        <ClockCircleOutlined style={{ marginRight: 8 }} />
        Last 24 Hours
      </Title>
      <Row gutter={[16, 16]} style={{ marginBottom: 32 }}>
        <Col xs={24} sm={8}>
          <Card styles={{ body: { padding: '20px 24px' } }} style={{ borderTop: '3px solid #1890ff' }}>
            <Statistic
              title="Total Attempts (24h)"
              value={stats.last24_total}
              valueStyle={{ fontSize: 28 }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card styles={{ body: { padding: '20px 24px' } }} style={{ borderTop: '3px solid #52c41a' }}>
            <Statistic
              title="Successful (24h)"
              value={stats.last24_ok}
              valueStyle={{ color: '#52c41a', fontSize: 28 }}
              prefix={<CheckCircleOutlined />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card styles={{ body: { padding: '20px 24px' } }} style={{ borderTop: '3px solid #ff4d4f' }}>
            <Statistic
              title="Failed (24h)"
              value={stats.last24_fail}
              valueStyle={{ color: '#ff4d4f', fontSize: 28 }}
              prefix={<CloseCircleOutlined />}
            />
          </Card>
        </Col>
      </Row>

      {/* Charts */}
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card title="By Server" styles={{ body: { padding: '16px 24px' } }}>
            {serverData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={serverData} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" />
                  <YAxis type="category" dataKey="name" width={100} />
                  <Tooltip />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                    {serverData.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <Empty description="No server data available" />
            )}
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="By Domain" styles={{ body: { padding: '16px 24px' } }}>
            {domainData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={domainData} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" />
                  <YAxis type="category" dataKey="name" width={120} />
                  <Tooltip />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                    {domainData.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <Empty description="No domain data available" />
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default Dashboard;
