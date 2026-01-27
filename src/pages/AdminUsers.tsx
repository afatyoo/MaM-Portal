import React, { useState, useEffect, useCallback } from 'react';
import {
  Table,
  Button,
  Card,
  Form,
  Input,
  Space,
  Typography,
  Row,
  Col,
  message,
  Divider,
  theme,
  Popconfirm,
  Tag,
} from 'antd';
import {
  ReloadOutlined,
  UserAddOutlined,
  UserOutlined,
  LockOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import api from '@/api/axios';
import { useAuth } from '@/contexts/AuthContext';
import type { AdminUser } from '@/types/admin';

const { Title, Text } = Typography;

interface AddUserFormValues {
  username: string;
  password: string;
  confirmPassword: string;
}

const AdminUsers: React.FC = () => {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [addingUser, setAddingUser] = useState(false);
  const [deletingUser, setDeletingUser] = useState<string | null>(null);

  const [form] = Form.useForm();
  const { token } = theme.useToken();
  const { username: currentUser } = useAuth();

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get('/api/admin/users');
      setUsers(response.data.users || []);
    } catch {
      message.error('Failed to load users');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleAddUser = async (values: AddUserFormValues) => {
    setAddingUser(true);
    try {
      await api.post('/api/admin/users', {
        username: values.username,
        password: values.password,
      });
      message.success('User added successfully');
      form.resetFields();
      fetchUsers();
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Failed to add user');
    } finally {
      setAddingUser(false);
    }
  };

  const handleDeleteUser = async (username: string) => {
    if (!username) return;
    setDeletingUser(username);
    try {
      await api.delete(`/api/admin/users/${encodeURIComponent(username)}`);
      message.success(`User "${username}" deleted`);
      fetchUsers();
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Failed to delete user');
    } finally {
      setDeletingUser(null);
    }
  };

  const columns: ColumnsType<AdminUser> = [
    {
      title: 'Username',
      dataIndex: 'username',
      key: 'username',
      render: (value: string) => (
        <Space>
          <UserOutlined style={{ color: token.colorPrimary }} />
          <Text strong>{value}</Text>
        </Space>
      ),
    },
    {
      title: 'Created At',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (value: string) => {
        const date = new Date(value);
        return date.toLocaleString('id-ID', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });
      },
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_: any, record: AdminUser) => {
        const isSelf = !!currentUser && record.username === currentUser;
        const isBusy = !!deletingUser;

        return (
          <Space>
            {isSelf && <Tag color="blue">You</Tag>}
            <Popconfirm
              title={`Delete ${record.username}?`}
              description="Admin access will be removed. This action cannot be undone."
              onConfirm={() => handleDeleteUser(record.username)}
              okText="Delete"
              okButtonProps={{ danger: true }}
              cancelText="Cancel"
              disabled={isSelf || isBusy}
            >
              <Button
                danger
                icon={<DeleteOutlined />}
                loading={deletingUser === record.username}
                disabled={isSelf || isBusy}
              >
                Delete
              </Button>
            </Popconfirm>
          </Space>
        );
      },
    },
  ];

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 24,
        }}
      >
        <Title level={4} style={{ margin: 0 }}>
          Admin Users
        </Title>
        <Button icon={<ReloadOutlined />} onClick={fetchUsers} loading={loading}>
          Refresh
        </Button>
      </div>

      <Row gutter={24}>
        <Col xs={24} lg={14}>
          <Card title="User List" styles={{ body: { padding: 0 } }}>
            <Table
              columns={columns}
              dataSource={users}
              rowKey="username"
              loading={loading}
              pagination={false}
              locale={{ emptyText: 'No admin users found' }}
            />
          </Card>
        </Col>

        <Col xs={24} lg={10}>
          <Card
            title={
              <Space>
                <UserAddOutlined />
                <span>Add New Admin</span>
              </Space>
            }
          >
            <Form form={form} layout="vertical" onFinish={handleAddUser} autoComplete="off">
              <Form.Item
                name="username"
                label="Username"
                rules={[
                  { required: true, message: 'Please enter username' },
                  { min: 3, message: 'Username must be at least 3 characters' },
                  { pattern: /^[a-zA-Z0-9_]+$/, message: 'Only letters, numbers and underscore allowed' },
                ]}
              >
                <Input
                  prefix={<UserOutlined style={{ color: token.colorTextSecondary }} />}
                  placeholder="Enter username"
                />
              </Form.Item>

              <Form.Item
                name="password"
                label="Password"
                rules={[
                  { required: true, message: 'Please enter password' },
                  { min: 8, message: 'Password must be at least 8 characters' },
                ]}
              >
                <Input.Password
                  prefix={<LockOutlined style={{ color: token.colorTextSecondary }} />}
                  placeholder="Enter password"
                />
              </Form.Item>

              <Form.Item
                name="confirmPassword"
                label="Confirm Password"
                dependencies={['password']}
                rules={[
                  { required: true, message: 'Please confirm password' },
                  ({ getFieldValue }) => ({
                    validator(_, value) {
                      if (!value || getFieldValue('password') === value) return Promise.resolve();
                      return Promise.reject(new Error('Passwords do not match'));
                    },
                  }),
                ]}
              >
                <Input.Password
                  prefix={<LockOutlined style={{ color: token.colorTextSecondary }} />}
                  placeholder="Confirm password"
                />
              </Form.Item>

              <Divider />

              <Form.Item style={{ marginBottom: 0 }}>
                <Button
                  type="primary"
                  htmlType="submit"
                  icon={<UserAddOutlined />}
                  loading={addingUser}
                  disabled={addingUser}
                  block
                  style={{ height: 40 }}
                >
                  Add Admin User
                </Button>
              </Form.Item>
            </Form>
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default AdminUsers;
