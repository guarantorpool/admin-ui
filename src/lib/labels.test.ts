import { connectionType, guaranteeStatus, kycStatus, memberStatus, metricName, percent, proofOfAddress, sentence } from './labels';
import { fullName } from './names';

describe('status labels', () => {
  it('reads each code with the wireframe colour', () => {
    expect(memberStatus('disabled')).toEqual({ text: 'Disabled', tone: 'bad' });
    expect(memberStatus('active')).toEqual({ text: 'Active', tone: 'ok' });
    expect(kycStatus('not_submitted')).toEqual({ text: 'Not submitted', tone: 'neutral' });
    expect(kycStatus('pending').tone).toBe('warn');
    expect(proofOfAddress('partial').text).toBe('Map pin only');
    expect(guaranteeStatus('pending_payment').text).toBe('Quote');
  });

  it('shows a code it does not know yet readably, and a missing one as a dash', () => {
    expect(memberStatus('on_hold')).toEqual({ text: 'On hold', tone: 'neutral' });
    expect(kycStatus(undefined).text).toBe('—');
    expect(connectionType('mutual_trust')).toBe('Mutual trust');
    expect(metricName('lp_held')).toBe('LP tokens held');
    expect(sentence('in-review')).toBe('In review');
  });
});

describe('percent', () => {
  it('shows a fraction as a percentage, without float noise', () => {
    expect(percent(0.15)).toBe('15%');
    expect(percent('0.7')).toBe('70%');
    expect(percent(0.285)).toBe('28.5%');
    expect(percent(1)).toBe('100%');
    expect(percent(null)).toBe('—');
    expect(percent('x')).toBe('—');
  });
});

describe('fullName', () => {
  it('joins the parts there are', () => {
    expect(fullName({ firstName: 'Amina', middleName: null, lastName: 'Wanjiru' })).toBe('Amina Wanjiru');
    expect(fullName({ firstName: 'Amina', middleName: 'N', lastName: 'Wanjiru' })).toBe('Amina N Wanjiru');
    expect(fullName(undefined)).toBe('');
  });
});
