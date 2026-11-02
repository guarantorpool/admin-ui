import * as React from 'react';
import { toast } from 'sonner';
import { errorMessage } from '@/api/errors';
import { getFileLink } from '@/api/members';

/**
 * Opens an uploaded file in a new tab. A private file's link is signed and lasts a few minutes, so it's asked
 * for on each open. `opening` is the id of the file being opened, for its button.
 */
export function useOpenFile() {
  const [opening, setOpening] = React.useState('');

  // the tab opens before the link is fetched, so the browser doesn't block it as a pop-up
  const open = async (uploadId: string) => {
    const tab = window.open('', '_blank');
    setOpening(uploadId);
    try {
      const { url } = await getFileLink(uploadId);
      if (!url) throw new Error('The backend gave no link for this file.');
      if (tab) {
        tab.opener = null;
        tab.location.href = url;
      } else window.location.assign(url);
    } catch (err) {
      tab?.close();
      toast.error(errorMessage(err));
    } finally {
      setOpening('');
    }
  };

  return { open, opening };
}
