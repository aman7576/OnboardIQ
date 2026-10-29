import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { createApplication, getOccupations, type NewApplicationInput } from '@/api/client';
import { ApiError } from '@/api/http';
import { Field } from '@/components/common/Field';
import { PageHeader } from '@/components/common/PageHeader';
import { ErrorState, LoadingState } from '@/components/common/States';
import { useToast } from '@/components/toast/toast-context';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useAsync } from '@/hooks/useAsync';

type Values = Record<
  | 'full_name'
  | 'dob'
  | 'gender'
  | 'pan_number'
  | 'aadhaar_last4'
  | 'mobile'
  | 'email'
  | 'address'
  | 'city'
  | 'state'
  | 'pincode'
  | 'occupation_code'
  | 'annual_income',
  string
> & { consent_kyc: boolean };
type Errors = Partial<Record<keyof Values, string>>;

const EMPTY: Values = {
  full_name: '',
  dob: '',
  gender: '',
  pan_number: '',
  aadhaar_last4: '',
  mobile: '',
  email: '',
  address: '',
  city: '',
  state: '',
  pincode: '',
  occupation_code: '',
  annual_income: '',
  consent_kyc: false,
};

/**
 * Quick format checks so mistakes are caught before sending. The backend validates everything again and its
 * messages (including the PAN pattern from the configuration) are shown next to the same fields.
 */
function check(v: Values, today: string): Errors {
  const e: Errors = {};
  const need = (k: keyof Values, label: string) => {
    if (typeof v[k] === 'string' && !(v[k] as string).trim()) e[k] = `Enter ${label}.`;
  };
  need('full_name', 'your full name');
  need('address', 'your address');
  need('city', 'your city');
  need('state', 'your state');
  if (!v.dob) e.dob = 'Enter your date of birth.';
  else if (v.dob > today) e.dob = 'Date of birth cannot be in the future.';
  if (!v.gender) e.gender = 'Choose a gender.';
  if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(v.pan_number))
    e.pan_number = 'Enter the PAN in the format AAAAA9999A (capital letters and digits).';
  if (/^\d{5,}$/.test(v.aadhaar_last4.replace(/\s/g, '')))
    e.aadhaar_last4 =
      'Only the last 4 digits of Aadhaar are accepted. Do not enter the full 12-digit number.';
  else if (!/^\d{4}$/.test(v.aadhaar_last4)) e.aadhaar_last4 = 'Enter exactly 4 digits.';
  if (!/^[6-9]\d{9}$/.test(v.mobile))
    e.mobile = 'Enter a 10-digit mobile number starting with 6, 7, 8 or 9.';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email)) e.email = 'Enter a valid e-mail address.';
  if (!/^[1-9]\d{5}$/.test(v.pincode))
    e.pincode = 'Enter a 6-digit pincode (it cannot start with 0).';
  if (!v.occupation_code) e.occupation_code = 'Choose your occupation.';
  if (
    v.annual_income === '' ||
    Number.isNaN(Number(v.annual_income)) ||
    Number(v.annual_income) < 0 ||
    !Number.isInteger(Number(v.annual_income))
  )
    e.annual_income = 'Enter your yearly income in whole rupees (0 or more).';
  if (!v.consent_kyc) e.consent_kyc = 'Consent to KYC checks is required to open an account.';
  return e;
}

export function NewApplication() {
  const navigate = useNavigate();
  const toast = useToast();
  const occupations = useAsync(() => getOccupations(), []);
  const [values, setValues] = useState<Values>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const today = new Date().toISOString().slice(0, 10);

  const set = <K extends keyof Values>(key: K, value: Values[K]) =>
    setValues((v) => ({ ...v, [key]: value }));
  const on = (key: keyof Values) => ({
    onBlur: () => setErrors((e) => ({ ...e, [key]: check(values, today)[key] })),
  });

  async function submit(event: FormEvent) {
    event.preventDefault();
    const found = check(values, today);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      document.getElementById(`f-${Object.keys(found)[0]}`)?.focus();
      toast.error('Please fix the highlighted fields.');
      return;
    }
    setBusy(true);
    try {
      const input: NewApplicationInput = {
        ...values,
        gender: values.gender as 'M' | 'F',
        annual_income: Number(values.annual_income),
        consent_kyc: true,
      };
      const created = await createApplication(input);
      toast.success(`Application ${created.application_id} created. Now upload your documents.`);
      void navigate(`/applications/${created.application_id}/upload`);
    } catch (err) {
      if (err instanceof ApiError && err.fields.length) {
        const fromServer: Errors = {};
        for (const f of err.fields) fromServer[f.field as keyof Values] = f.message;
        setErrors(fromServer);
        toast.error('The server rejected some fields. Please correct them.');
      } else toast.error(err instanceof ApiError ? err.message : 'Could not reach the server.');
      setBusy(false);
    }
  }

  const failed = Object.entries(errors).filter(([, m]) => m);
  return (
    <>
      <PageHeader
        eyebrow="Applicant"
        title="New application"
        description="Tell us about yourself. In the next step you upload your documents."
      />
      {occupations.status === 'loading' && <LoadingState label="Loading the form" />}
      {occupations.status === 'error' && (
        <ErrorState error={occupations.error} onRetry={occupations.reload} />
      )}
      {occupations.status === 'success' && (
        <form onSubmit={(e) => void submit(e)} noValidate className="grid max-w-3xl gap-6">
          {failed.length > 0 && (
            <Alert
              tone="danger"
              title={`${failed.length} field${failed.length > 1 ? 's need' : ' needs'} your attention`}
            >
              <ul className="list-disc pl-5">
                {failed.map(([k, m]) => (
                  <li key={k}>{m}</li>
                ))}
              </ul>
            </Alert>
          )}
          <Card>
            <CardHeader>
              <CardTitle>Personal details</CardTitle>
              <CardDescription>As they appear on your PAN card.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Field id="f-full_name" label="Full name" required error={errors.full_name}>
                  <Input
                    value={values.full_name}
                    autoComplete="name"
                    onChange={(e) => set('full_name', e.target.value)}
                    {...on('full_name')}
                  />
                </Field>
              </div>
              <Field id="f-dob" label="Date of birth" required error={errors.dob}>
                <Input
                  type="date"
                  max={today}
                  value={values.dob}
                  autoComplete="bday"
                  onChange={(e) => set('dob', e.target.value)}
                  {...on('dob')}
                />
              </Field>
              <Field id="f-gender" label="Gender" required error={errors.gender}>
                <Select
                  value={values.gender}
                  onChange={(e) => set('gender', e.target.value)}
                  {...on('gender')}
                >
                  <option value="">Choose…</option>
                  <option value="F">Female</option>
                  <option value="M">Male</option>
                </Select>
              </Field>
              <Field
                id="f-pan_number"
                label="PAN"
                required
                hint="Format AAAAA9999A"
                error={errors.pan_number}
              >
                <Input
                  value={values.pan_number}
                  maxLength={10}
                  autoCapitalize="characters"
                  spellCheck={false}
                  onChange={(e) => set('pan_number', e.target.value.toUpperCase())}
                  {...on('pan_number')}
                />
              </Field>
              <Field
                id="f-aadhaar_last4"
                label="Aadhaar: last 4 digits only"
                required
                hint="We never ask for the full Aadhaar number."
                error={errors.aadhaar_last4}
              >
                <Input
                  value={values.aadhaar_last4}
                  inputMode="numeric"
                  autoComplete="off"
                  onChange={(e) => set('aadhaar_last4', e.target.value)}
                  {...on('aadhaar_last4')}
                />
              </Field>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Contact and address</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field id="f-mobile" label="Mobile number" required error={errors.mobile}>
                <Input
                  type="tel"
                  inputMode="numeric"
                  maxLength={10}
                  autoComplete="tel-national"
                  value={values.mobile}
                  onChange={(e) => set('mobile', e.target.value)}
                  {...on('mobile')}
                />
              </Field>
              <Field id="f-email" label="E-mail" required error={errors.email}>
                <Input
                  type="email"
                  autoComplete="email"
                  value={values.email}
                  onChange={(e) => set('email', e.target.value)}
                  {...on('email')}
                />
              </Field>
              <div className="sm:col-span-2">
                <Field id="f-address" label="Address" required error={errors.address}>
                  <Textarea
                    className="min-h-20"
                    autoComplete="street-address"
                    value={values.address}
                    onChange={(e) => set('address', e.target.value)}
                    {...on('address')}
                  />
                </Field>
              </div>
              <Field id="f-city" label="City" required error={errors.city}>
                <Input
                  value={values.city}
                  autoComplete="address-level2"
                  onChange={(e) => set('city', e.target.value)}
                  {...on('city')}
                />
              </Field>
              <Field id="f-state" label="State" required error={errors.state}>
                <Input
                  value={values.state}
                  autoComplete="address-level1"
                  onChange={(e) => set('state', e.target.value)}
                  {...on('state')}
                />
              </Field>
              <Field id="f-pincode" label="Pincode" required error={errors.pincode}>
                <Input
                  inputMode="numeric"
                  maxLength={6}
                  autoComplete="postal-code"
                  value={values.pincode}
                  onChange={(e) => set('pincode', e.target.value)}
                  {...on('pincode')}
                />
              </Field>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Occupation and income</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field
                id="f-occupation_code"
                label="Occupation"
                required
                error={errors.occupation_code}
              >
                <Select
                  value={values.occupation_code}
                  onChange={(e) => set('occupation_code', e.target.value)}
                  {...on('occupation_code')}
                >
                  <option value="">Choose…</option>
                  {occupations.data.occupations.map((o) => (
                    <option key={o.code} value={o.code}>
                      {o.description}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                id="f-annual_income"
                label="Annual income (₹)"
                required
                error={errors.annual_income}
              >
                <Input
                  inputMode="numeric"
                  value={values.annual_income}
                  onChange={(e) => set('annual_income', e.target.value)}
                  {...on('annual_income')}
                />
              </Field>
            </CardContent>
          </Card>
          <div className="grid gap-1.5">
            <label className="flex items-start gap-3 text-sm">
              <input
                id="f-consent_kyc"
                type="checkbox"
                className="mt-1 size-4 accent-forest"
                checked={values.consent_kyc}
                aria-invalid={errors.consent_kyc ? true : undefined}
                aria-describedby={errors.consent_kyc ? 'f-consent_kyc-error' : undefined}
                onChange={(e) => set('consent_kyc', e.target.checked)}
              />
              <span>
                I consent to the bank checking my identity, address and screening me against
                official lists as part of KYC.{' '}
                <span aria-hidden className="text-danger">
                  *
                </span>
              </span>
            </label>
            {errors.consent_kyc && (
              <p id="f-consent_kyc-error" className="text-xs font-medium text-danger">
                {errors.consent_kyc}
              </p>
            )}
          </div>
          <div className="flex gap-3">
            <Button type="submit" size="lg" loading={busy}>
              Continue to documents
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="lg"
              onClick={() => void navigate('/applications')}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
    </>
  );
}
