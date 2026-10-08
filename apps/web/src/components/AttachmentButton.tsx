import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Paperclip } from 'lucide-react';
import { toast } from 'sonner';
import { openAttachment } from '@/lib/files';
import { errorMessage } from '@/lib/supabase';
import { Button } from './ui/button';

export function AttachmentButton({ path, label }: { path: string; label?: string }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      loading={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await openAttachment(path);
        } catch (e) {
          toast.error(errorMessage(e));
        } finally {
          setBusy(false);
        }
      }}
    >
      <Paperclip /> {label ?? t('View attachment')}
    </Button>
  );
}
