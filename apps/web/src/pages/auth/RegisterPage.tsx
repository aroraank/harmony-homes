import { PhoneInput } from '@/components/PhoneInput';
import { PinInput } from '@/components/PinInput';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, UserPlus } from 'lucide-react';
import { mobileSchema, personNameSchema } from '@harmony/shared';
import { DEFAULT_SOCIETY_SLUG, errorMessage, invokeFn, supabase } from '@/lib/supabase';
import { getLocal } from '@/lib/storage';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { Field } from '@/components/Field';
import { Alert } from '@/components/ui/alert';
import { AuthLayout } from './AuthLayout';

type Options = {
  society: { id: string; name: string; slug: string };
  unit_types: { id: string; name: string }[];
  units: { id: string; code: string; display_name: string; unit_type_id: string; available: boolean }[];
};

const schema = z
  .object({
    fullName: personNameSchema,
    mobile: mobileSchema,
    unitTypeId: z.string().min(1, 'Choose your flat type'),
    unitId: z.string().min(1, 'Choose your flat'),
    password: z.string().regex(/^\d{6,12}$/, 'PIN must be 6 to 12 digits, numbers only'),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'PINs do not match' });

type Form = z.input<typeof schema>;

export default function RegisterPage() {
  const { t } = useTranslation();
  const [slug] = useState(() => getLocal('hh-slug') || DEFAULT_SOCIETY_SLUG);
  const [done, setDone] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const opts = useQuery({
    queryKey: ['registrationOptions', slug],
    enabled: !!slug,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('registration_options', { p_slug: slug });
      if (error) throw error;
      return data as Options | null;
    },
  });

  const form = useForm<Form>({ resolver: zodResolver(schema), defaultValues: { unitTypeId: '', unitId: '' } });
  const typeId = form.watch('unitTypeId');
  const units = useMemo(() => (opts.data?.units ?? []).filter((u) => u.unit_type_id === typeId), [opts.data, typeId]);

  const onSubmit = form.handleSubmit(async (raw) => {
    setServerError(null);
    const v = schema.parse(raw);
        try {
      const res = await invokeFn<{ ok: boolean; username: string }>('account', {
        action: 'register',
        society_slug: slug,
        unit_id: v.unitId,
        full_name: v.fullName,
        mobile: v.mobile,
        password: v.password,
      });
      setDone(res.username);
    } catch (e) {
      setServerError(errorMessage(e));
    }
  });

  if (done)
    return (
      <AuthLayout title={t('Registration sent')} society={opts.data?.society.name}>
        <div className="flex flex-col items-center text-center">
          <CheckCircle2 className="size-14 text-primary" />
          <p className="mt-3 font-semibold">{t('The admin will review and approve your registration.')}</p>
          <p className="mt-2 text-sm text-muted-foreground">
            {t('After approval, sign in with username {{u}} and the PIN you just chose.', { u: done })}
          </p>
          <Button asChild className="mt-5 w-full" size="lg">
            <Link to="/login">{t('Back to sign in')}</Link>
          </Button>
        </div>
      </AuthLayout>
    );

  const e = form.formState.errors;
  return (
    <AuthLayout title={t('Register your flat')} subtitle={t('New registrations are approved by the admin.')} society={opts.data?.society.name}>
      {!slug || (opts.isFetched && !opts.data) ? (
        <Alert variant="warning">{t('Society not found. Open the link shared by your committee.')}</Alert>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <Field label={t('Full name')} error={e.fullName?.message && t(e.fullName.message)}>
            <Input {...form.register('fullName')} maxLength={60} autoComplete="name" placeholder="Rohit Sharma" />
          </Field>
          <Field label={t('Mobile number')} error={e.mobile?.message && t(e.mobile.message)} hint={t('10-digit Indian mobile')}>
            <PhoneInput {...form.register('mobile')} placeholder="98765 43210" />
          </Field>
          <Field label={t('Flat type')} error={e.unitTypeId?.message && t(e.unitTypeId.message)}>
            <NativeSelect {...form.register('unitTypeId', { onChange: () => form.setValue('unitId', '') })}>
              <option value="">{t('Choose…')}</option>
              {opts.data?.unit_types.map((ut) => (
                <option key={ut.id} value={ut.id}>
                  {ut.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label={t('Your flat')} error={e.unitId?.message && t(e.unitId.message)} hint={t('Flats that already have an account are not listed.')}>
            <NativeSelect {...form.register('unitId')} disabled={!typeId}>
              <option value="">{typeId ? t('Choose…') : t('Pick the flat type first')}</option>
              {units.filter((u) => u.available).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.code} — {u.display_name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label={t('PIN')} error={e.password?.message && t(e.password.message)} hint={t('6 to 12 digits, numbers only.')}>
            <PinInput defaultShown value={form.watch('password') ?? ''} onChange={(v) => form.setValue('password', v, { shouldValidate: form.formState.isSubmitted })} />
          </Field>
          <Field label={t('Confirm PIN')} error={e.confirm?.message && t(e.confirm.message)}>
            <PinInput defaultShown value={form.watch('confirm') ?? ''} onChange={(v) => form.setValue('confirm', v, { shouldValidate: form.formState.isSubmitted })} />
          </Field>
          {serverError && <Alert variant="danger">{serverError}</Alert>}
          <Button type="submit" size="xl" variant="hero" className="w-full" loading={form.formState.isSubmitting}>
            <UserPlus /> {t('Submit registration')}
          </Button>
          <p className="text-center text-sm">
            <Link to="/login" className="font-semibold text-primary hover:underline">
              {t('Already have a login? Sign in')}
            </Link>
          </p>
        </form>
      )}
    </AuthLayout>
  );
}
