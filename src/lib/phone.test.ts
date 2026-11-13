import { cleanPhone, isPhone } from './phone';

describe('phone rule', () => {
  it('takes Kenyan numbers in any of their usual forms', () => {
    for (const p of ['0712345678', '0112345678', '254712345678', '+254712345678', '0712 345-678']) expect(isPhone(p)).toBe(true);
  });

  it('takes other countries’ numbers with + and the country code', () => {
    for (const p of ['+447700900123', '+1 415 555 0123', '+256772123456']) expect(isPhone(p)).toBe(true);
  });

  it('matches the backend in what it refuses', () => {
    for (const p of ['447700900123', '+44123', '+0447700900123', '+4477009001234567', '+254912345678', '0512345678', 'not a phone']) expect(isPhone(p)).toBe(false);
  });

  it('drops spaces and hyphens', () => {
    expect(cleanPhone(' +44 7700-900123 ')).toBe('+447700900123');
  });
});
