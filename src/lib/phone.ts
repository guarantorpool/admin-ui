// The backend's phone rule (ValidationPatterns.PHONE): a Kenyan mobile number, written 07…/01…, 254… or +254…,
// or any other country's number written with + and its country code (7 to 15 digits, as in E.164).
const PHONE = /^(?:\+?(?:254|0)[17]\d{8}|\+(?!254)[1-9]\d{6,14})$/;

export const PHONE_MESSAGE = 'Enter a mobile number: a Kenyan one such as 0712345678, or another country’s starting with + and the country code, such as +447700900123.';

/** The number without the spaces and hyphens people type, as it is sent to the backend. */
export function cleanPhone(phone: string): string {
  return phone.replace(/[\s-]/g, '');
}

export function isPhone(phone: string): boolean {
  return PHONE.test(cleanPhone(phone));
}
