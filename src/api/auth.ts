import { api } from './client';
import type { Account, ResetCodeResponse, MessageResponse, OtpChallenge, Schemas } from './types';

type LoginResponse = Schemas['LoginResponse'];
const open = { auth: false } as const;

// Sign-in, step 1: checks the password and emails a one-time code (BlockCoop D-009).
export const adminLogin = (email: string, password: string) =>
  api.post<OtpChallenge>('/auth/admin-login', { identifier: email, password } satisfies Schemas['LoginRequest'], open);

// Sign-in, step 2: checks the code and returns the tokens.
export const verifyOtp = (challengeId: string, code: string) =>
  api.post<LoginResponse>('/auth/verify-otp', { challengeId, code } satisfies Schemas['VerifyOtpRequest'], open);

export const resendOtp = (challengeId: string) =>
  api.post<OtpChallenge>('/auth/resend-otp', { challengeId } satisfies Schemas['ResendOtpRequest'], open);

// Emails a 6-digit reset code. It answers the same for every email; calling it again is the resend, which the
// backend ignores until its wait is over.
export const forgotPassword = (email: string) =>
  api.post<ResetCodeResponse>('/auth/forgot-password', { email } satisfies Schemas['EmailRequest'], open);

// A wrong or expired code answers 400 "This code is invalid or has expired".
export const resetPassword = (email: string, code: string, newPassword: string) =>
  api.post<MessageResponse>('/auth/reset-password', { email, code, newPassword } satisfies Schemas['ResetPasswordRequest'], open);

// The new-admin invitation, with the token from the emailed link.
export const setPassword = (token: string, newPassword: string) =>
  api.post<MessageResponse>('/auth/set-password', { token, newPassword } satisfies Schemas['NewPasswordRequest'], open);

export const getProfile = () => api.get<Account>('/auth/profile');

export const updateProfile = (changes: Schemas['UpdateProfileRequest']) => api.patch<Account>('/auth/profile', changes);

// Ends every session, this one included.
export const changePassword = (currentPassword: string, newPassword: string) =>
  api.post<MessageResponse>('/auth/change-password', { currentPassword, newPassword } satisfies Schemas['ChangePasswordRequest']);

export const logoutAll = () => api.post<MessageResponse>('/auth/logout-all');

export function uploadProfileImage(file: File) {
  const form = new FormData();
  form.append('file', file);
  return api.post<Account>('/uploads/profile-image', form);
}

export const deleteProfileImage = (ownerId: string) => api.delete<void>(`/uploads/profile-image/${encodeURIComponent(ownerId)}`);
