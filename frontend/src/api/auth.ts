import type { Role } from './types';
import { apiFetch } from './http';

export interface User {
  id: string;
  email: string;
  display_name: string;
  role: Role;
}

export interface LoginResponse {
  token: string;
  token_type: 'Bearer';
  expires_at: string;
  user: User;
}

export const login = (email: string, password: string) =>
  apiFetch<LoginResponse>('/api/v1/auth/login', { method: 'POST', body: { email, password } });

export const logout = () => apiFetch<undefined>('/api/v1/auth/logout', { method: 'POST' });

export const fetchMe = () => apiFetch<{ user: User }>('/api/v1/auth/me');

export const registerOfficer = (body: {
  email: string;
  password: string;
  display_name: string;
  role: 'KYC_OFFICER' | 'COMPLIANCE_OFFICER';
  enrollment_code: string;
}) => apiFetch<{ user: User }>('/api/v1/auth/register-staff', { method: 'POST', body });

export const register = (body: { email: string; password: string; display_name: string }) =>
  apiFetch<{ user: User }>('/api/v1/auth/register', { method: 'POST', body });
