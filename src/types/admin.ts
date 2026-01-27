export interface AdminUser {
  username: string;
  created_at: string;
}

export interface LogEntry {
  timestamp: string;
  email: string;
  domain: string;
  server_key: string;
  result: 'ok' | 'fail';
  ip: string;
  ms: number;
  ua?: string;
}

export interface Stats {
  total: number;
  ok: number;
  fail: number;
  last24_total: number;
  last24_ok: number;
  last24_fail: number;
  byServer: Record<string, number>;
  byDomain: Record<string, number>;
}

export interface AuthState {
  isLoading: boolean;
  isAuthenticated: boolean;
  username: string | null;
}

export interface ZimbraServer {
  key: string;
  name: string;
  server: string;
  domains: string[];
  preauthkey_masked?: string;
  soap_path: string;
  preauth_path: string;
  ca_file?: string;
  insecure_tls: boolean;
}

export interface ZimbraServerFormData {
  key: string;
  name: string;
  server: string;
  domains: string[];
  preauthkey: string;
  soap_path: string;
  preauth_path: string;
  ca_file?: string;
  insecure_tls: boolean;
}

export interface TestConnectionResult {
  ok: boolean;
  error?: string;
  details?: {
    soap: string;
    tls: string;
    status: number;
  };
}
