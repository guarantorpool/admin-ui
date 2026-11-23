import { describe, expect, it } from 'vitest';
import { PICK_LISTS, pickList } from '@/api/lists';
import { auditAction, recordPath, recordType } from '@/lib/audit';
import { entryType, listRequestStatus } from '@/lib/labels';
import { moduleLabel, permissionLabel } from '@/lib/roles';
import { namesIn } from './ListsPage';

describe('suggestion lists (BlockCoop D-043)', () => {
  it('knows the nine lists, and which of them admins keep', () => {
    expect(PICK_LISTS.map((l) => l.path)).toEqual(['counties', 'sub-counties', 'towns', 'industries', 'professions', 'interests', 'communities', 'organisations', 'schools']);
    expect(PICK_LISTS.filter((l) => !l.kept).map((l) => l.path)).toEqual(['counties', 'sub-counties']);
    expect(pickList('interests')?.kept).toBe(true);
    expect(pickList('nope')).toBeUndefined();
  });

  it('takes pasted names one a line, without blanks or repeats in any case', () => {
    expect(namesIn('Alliance High\r\n\n  alliance high \nKenya  High\n\nStarehe Boys')).toEqual(['Alliance High', 'Kenya High', 'Starehe Boys']);
    expect(namesIn('  \n')).toEqual([]);
  });

  it('reads types and request statuses', () => {
    expect(entryType('SACCO')).toBe('SACCO');
    expect(entryType('BUSINESS')).toBe('Own business');
    expect(entryType('PROFESSIONAL_BODY')).toBe('Professional body');
    expect(listRequestStatus('PENDING')).toEqual({ text: 'Waiting', tone: 'warn' });
  });

  it('names the permissions and audit entries', () => {
    expect(moduleLabel('LISTS')).toBe('Suggestion lists');
    expect(permissionLabel('LISTS.MANAGE')).toBe('Manage');
    expect(auditAction('LIST_ENTRIES_ADDED')).toBe('List entries added in bulk');
    expect(recordType('list_request')).toBe('Request for a list entry');
    expect(recordPath('list', 'schools')).toBe('/lists?view=entries&list=schools');
  });
});
