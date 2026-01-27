import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { message } from 'antd';
import api from '@/api/axios';
import type { AuthState } from '@/types/admin';

interface AuthContextType extends AuthState {
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [authState, setAuthState] = useState<AuthState>({
    isLoading: true,
    isAuthenticated: false,
    username: null,
  });

  const checkAuth = useCallback(async (): Promise<boolean> => {
    try {
      const response = await api.get('/api/admin/me');
      const { loggedIn, username } = response.data;
      
      setAuthState({
        isLoading: false,
        isAuthenticated: loggedIn,
        username: loggedIn ? username : null,
      });
      
      return loggedIn;
    } catch (error) {
      setAuthState({
        isLoading: false,
        isAuthenticated: false,
        username: null,
      });
      return false;
    }
  }, []);

  const login = useCallback(async (username: string, password: string): Promise<boolean> => {
    try {
      await api.post('/api/admin/login', { username, password });
      await checkAuth();
      message.success('Login successful');
      return true;
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Login failed');
      return false;
    }
  }, [checkAuth]);

  const logout = useCallback(async (): Promise<void> => {
    try {
      await api.post('/api/admin/logout');
      setAuthState({
        isLoading: false,
        isAuthenticated: false,
        username: null,
      });
      message.success('Logged out successfully');
    } catch (error) {
      message.error('Logout failed');
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  return (
    <AuthContext.Provider value={{ ...authState, login, logout, checkAuth }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
