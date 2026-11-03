import { checkNewPassword, passwordProblems } from './password';

describe('password rule', () => {
  it('matches the backend pattern', () => {
    expect(passwordProblems('Aa1!aaaa')).toEqual([]);
    expect(passwordProblems('short')).toEqual(['8 to 72 characters', 'a capital letter', 'a number', 'a symbol']);
    expect(passwordProblems('A'.repeat(70) + 'a1!')).toContain('8 to 72 characters');
  });

  it('checks the confirmation matches', () => {
    expect(checkNewPassword('Aa1!aaaa', 'Aa1!aaab')).toBe("The new passwords don't match.");
    expect(checkNewPassword('Aa1!aaaa', 'Aa1!aaaa')).toBe('');
  });
});
