-- Shrink the "attachments" storage bucket's hard size ceiling from 5 MB to 1.5 MB.
-- This is the REAL enforcement point — the app's own client-side checks (600 KB for images after
-- on-device compression, 1.5 MB for PDFs, which aren't compressed) can't be bypassed by anyone
-- hitting Supabase Storage directly, because Postgres/Storage itself now refuses anything bigger.
-- Keeps the free 1 GB storage bucket from filling up with oversized claim/concern/expense photos.
update storage.buckets
   set file_size_limit = 1572864  -- 1.5 MB, in bytes
 where id = 'attachments';
