import type { components } from './schema';

/** Request and response shapes, generated from the backend's OpenAPI document (npm run api:types). */
export type Schemas = components['schemas'];

export type LoginProfile = Schemas['Profile'];
export type OtpChallenge = Schemas['OtpChallengeResponse'];
export type Account = Schemas['AccountResponse'];
export type MessageResponse = Schemas['MessageResponse'];
export type ResetCodeResponse = Schemas['ResetCodeResponse'];
